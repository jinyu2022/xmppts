import { Status } from "./typing";
import type { TransportEndpoint, TransportSink } from "./typing";
import {
  StreamConnection,
  isStreamFeatures,
  type SendContext,
} from "./stream-connection";
import { Parser, type XMPPElement } from "@/ltx";
import { JID } from "@/JID";
import logger from "@/log";
// 传输层按需调用该静态方法解析端点；该模块不反向依赖传输层
import XEP0156 from "@/plugins/xep0156";

const log = logger.getLogger("WS");
const FRAMING_NS = "urn:ietf:params:xml:ns:xmpp-framing";

type BrowserWebSocket = typeof globalThis.WebSocket;
type WebSocketInstance = InstanceType<BrowserWebSocket>;

/**
 * XMPP over WebSocket (RFC 7395)
 *
 * 与 TCP（RFC 6120）的差异全部集中在本类：
 * - 流开启/关闭使用 framing：`<open/>` / `<close xmlns="...xmpp-framing"/>`
 * - 无 STARTTLS；TLS 由 wss:// 提供
 * - 每条 WebSocket 消息是一个完整 XML 文档（不是连续流）
 * - 必须使用 "xmpp" 子协议
 *
 * SASL/绑定/会话恢复流程由 {@link StreamConnection} 基类复用。
 */
export class WSConnection extends StreamConnection {
  private ws: WebSocketInstance | null = null;
  /** 端点配置；重连时复用 */
  private endpoint: TransportEndpoint;
  private readonly tls: boolean;
  host = "";
  port = "";

  constructor(
    jid: JID,
    password: string,
    sink: TransportSink,
    tls = true,
    endpoint?: TransportEndpoint,
  ) {
    super(jid, password, sink);
    this.tls = tls;
    this.endpoint = endpoint ?? {};
    // WebSocket 没有 STARTTLS：首个流特性直接进入 SASL 决策
    this.pipeline.use(
      "stream:features:starttls",
      this.onFeaturesStartTls.bind(this),
    );
  }

  /** 建立 WebSocket 连接（RFC 7395 §3）：按端点配置拼接地址，重连时复用 */
  protected async openTransport(_reconnect: boolean): Promise<void> {
    // 端点不完整时按 XEP-0156 从 host-meta 发现；重连沿用已解析的端点
    if (!this.endpoint.host || this.endpoint.port == null) {
      this.endpoint = await XEP0156.resolveEndpoint(this.jid.domain);
    }
    const endpoint = this.endpoint;

    const scheme = this.tls ? "wss" : "ws";
    // 缺省端口由最终 scheme 决定（host-meta 只报告显式端口）；写回端点供重连复用
    const port = endpoint.port ?? (this.tls ? 443 : 80);
    this.endpoint = { ...endpoint, port };
    const path = endpoint.path ? `/${endpoint.path.replace(/^\/+/, "")}` : "";
    const targetUrl = `${scheme}://${endpoint.host}:${port}${path}`;
    // 端点不完整时已由 resolveEndpoint 补齐，且 URL 解析保证 host 非空
    this.host = endpoint.host!;
    this.port = String(port);

    const WSCtor = await this.resolveWebSocket();
    log.debug("connecting", targetUrl);
    this.ws = new WSCtor(targetUrl, "xmpp");
    this.ws.onopen = () => this.onOpen();
    this.ws.onclose = (ev) => this.onClose(ev);
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onerror = () => this.onError();
  }

  private async resolveWebSocket(): Promise<BrowserWebSocket> {
    if (typeof globalThis.WebSocket !== "undefined") {
      return globalThis.WebSocket;
    }
    // Node.js optional dependency (`ws`)；非字面量说明符可避免 noImplicitAny 下的 TS7016
    const wsSpecifier: string = "ws";
    const mod = (await import(wsSpecifier)) as { default?: BrowserWebSocket } &
      BrowserWebSocket;
    return mod.default ?? mod;
  }

  private onOpen(): void {
    log.debug("open");
    this.openStream();
  }

  private onClose(ev: CloseEvent): void {
    this.ws = null;
    log.debug("ws close", ev.code, ev.reason);
    this.onTransportClosed(ev);
  }

  private onMessage(ev: MessageEvent): void {
    const data =
      typeof ev.data === "string"
        ? ev.data
        : Buffer.isBuffer(ev.data)
          ? ev.data.toString("utf8")
          : String(ev.data);
    log.debug("recv", data);
    this.feed(data);
  }

  private onError(): void {
    const err = new Error("WebSocket error");
    log.error("error", err);
    this.sink.onError(err);
  }

  /** 解析收到的完整 XML 文档；framing 节点先行处理（RFC 7395 §3） */
  protected feed(data: string): void {
    let stanza: XMPPElement;
    // RFC 7395: each WebSocket message is one complete XML document.
    try {
      stanza = Parser.parse(data);
    } catch (error) {
      log.error("parse failed", error, data);
      this.sink.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    if (stanza.localName === "open" && stanza.namespaceURI === FRAMING_NS) {
      log.info("framing open received");
      return;
    }
    if (stanza.localName === "close" && stanza.namespaceURI === FRAMING_NS) {
      log.info("server closed framing stream");
      this.status = Status.SESSIONEND;
      this.closeTransport();
      return;
    }
    void this.handleStanza(stanza);
  }

  /** WebSocket 没有 STARTTLS：首个流特性直接进入 SASL 决策 */
  private async onFeaturesStartTls(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    if (!isStreamFeatures(ctx.stanza)) {
      // 首次流特性之后只可能是 features；其他节交给 handleFailure 统一收尾
      throw new Error(`SASL 阶段收到非流特性节: ${ctx.stanza.tagName}`);
    }
    return this.onFeaturesMechanisms(ctx, next);
  }

  /** RFC 7395 stream open */
  protected sendStreamOpen(): void {
    this.writeRaw(
      `<open to="${this.domain}" version="1.0" xmlns="${FRAMING_NS}"/>`,
    );
  }

  /** RFC 7395 stream close */
  protected sendStreamClose(): void {
    this.writeRaw(`<close xmlns="${FRAMING_NS}"/>`);
  }

  protected writeRaw(data: string): void {
    if (!this.ws) {
      throw new Error("not connected");
    }
    if (this.ws.readyState !== 1 /* OPEN */) {
      throw new Error("websocket not open");
    }
    log.debug("send", data);
    this.ws.send(data);
  }

  protected closeTransport(): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.close();
    }
    this.ws = null;
    log.debug("disconnected");
  }
}

export default WSConnection;
