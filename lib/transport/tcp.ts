import { Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { resolveSrv } from "../dns";
import { Parser, escapeXML } from "@/ltx";

import { Status } from "./typing";
import type { TransportEndpoint, TransportSink } from "./typing";
import {
  StreamConnection,
  isStreamFeatures,
  type SendContext,
  type StanzaContext,
} from "./stream-connection";
import { JID } from "../JID";
import { ProtocolError } from "../errors";
import logger from "@/log";

const log = logger.getLogger("tcp");

/**
 * XMPP 明文 TCP / STARTTLS 连接（RFC 6120）。
 *
 * 认证与绑定流程由 {@link StreamConnection} 基类实现；本类只负责
 * TCP 传输差异：端点解析、socket 生命周期、RFC 6120 流头/流尾、
 * STARTTLS 决策与 TLS 升级。
 */
export class XMPPConnection extends StreamConnection {
  // NOSONAR: RFC 6120 固定的 XML 命名空间标识符，不是网络请求地址。
  static readonly STREAM_NS = "http://etherx.jabber.org/streams";
  static readonly STARTTLS_NS = "urn:ietf:params:xml:ns:xmpp-tls";
  private socket: Socket | TLSSocket | null = null;
  /** 是否使用 TLS（直连 TLS / 非 STARTTLS 升级路径） */
  private readonly tls: boolean;
  host: string;
  port = "5222";
  /** 默认连接端口（直连 TLS 子类覆盖为 5223） */
  protected readonly defaultPort: string = "5222";
  /** 常规 SRV 服务名；子类置为 undefined 时跳过 SRV 解析 */
  protected readonly srvService: string | undefined = "_xmpp-client._tcp";
  /** 用户显式指定的端点，优先于 SRV */
  private readonly explicitEndpoint?: TransportEndpoint;
  private readonly parser: Parser;

  constructor(
    jid: JID,
    password: string,
    sink: TransportSink,
    tls = true,
    endpoint?: TransportEndpoint,
  ) {
    super(jid, password, sink);
    this.tls = tls;
    this.explicitEndpoint = endpoint;
    this.host = jid.domain;
    this.parser = new Parser();
    // parser 跨连接复用（重连/STARTTLS 不重建），监听器仅注册一次，避免重复注册与误删
    this.parser.on("tree", (stanza) => {
      log.debug("解析到完整stanza:", stanza.tagName);
      void this.handleStanza(stanza);
    });
    // 对端关闭流（</stream:stream>）：按 RFC 6120 §4.4 回发流尾，再关闭本端 socket，避免半开悬挂
    this.parser.on("streamEnd", () => {
      if (this.status !== Status.SESSIONEND) {
        this.status = Status.SESSIONEND;
        try {
          this.sendStreamClose();
        } catch (error) {
          log.warn("回发流关闭标签失败，可能是连接已断开", error);
        }
      }
      this.closeTransport();
    });
    // 无 error 监听时 emit('error') 会以未捕获异常崩溃进程（服务端畸形 XML 可触发）
    this.parser.on("error", (error) => this.handleFailure(error));

    // TCP 特有的 STARTTLS 决策与升级；SASL/绑定处理器由基类注册
    this.pipeline
      .use("stream:features:starttls", this.onFeaturesStartTls.bind(this))
      .use("starttls:proceed", this.onStartTls.bind(this));
  }

  /** 建立 TCP 连接：端点解析、socket 创建、事件挂接与连接超时 */
  protected async openTransport(reconnect: boolean): Promise<void> {
    try {
      await this.resolveEndpoint(this.explicitEndpoint ?? {}, reconnect);
      // socket 由子类创建（默认明文，直连 TLS 子类覆盖）
      // keepAlive 属 net.Socket 构造选项，connect() 的选项不支持
      this.socket = this.createSocket();
      // 规范强制要求使用 UTF-8 编码（RFC 6120 §4.7.1）
      this.socket.setEncoding("utf8");
      this.setupSocketListeners();
      // pending=未连上 connecting=无人拨号 → 仅"未拨号"socket 由连接层拨号
      if (this.socket.pending && !this.socket.connecting)
        this.socket.connect(Number.parseInt(this.port), this.host);
      // 连接建立超时：30 秒未建立则放弃本次连接；状态与残留由 socket "close" 监听统一清理
      this.connectTimer = setTimeout(() => {
        if (this.status === Status.DISCONNECTED) return; // 已建立或已断开，不重复处理
        // 挂起的 socket 调 end() 不会立即关闭，销毁以尽快触发 close 事件
        this.socket?.destroy();
        this.sink.onError(
          new ProtocolError({
            scope: "stream",
            message: `连接超时: ${this.host}:${this.port}（30 秒内未建立连接）`,
            retryable: true,
          }),
        );
      }, 30_000);
      this.connectTimer?.unref?.();
    } catch (error) {
      // 回滚：半初始化的 socket 一并销毁，避免残留监听器与下次 connect() 复用
      this.socket?.removeAllListeners();
      this.socket?.destroy();
      this.socket = null;
      this.clearConnectTimer();
      throw error;
    }

    log.info(`正在连接 ${this.host}:${this.port}`);
  }

  /** socket 就绪事件：直连 TLS 子类覆盖为 secureConnect */
  protected get readyEvent(): "connect" | "secureConnect" {
    return "connect";
  }

  /** 创建底层 socket；直连 TLS 子类覆盖为 TLS 连接 */
  protected createSocket(): Socket | TLSSocket {
    return new Socket({ keepAlive: true });
  }

  /**
   * 解析连接端点：显式端点优先，无端点时查 SRV，最后回退 domain:默认端口。
   * 自动重连时沿用已有 host/port，不重复解析。
   */
  private async resolveEndpoint(
    endpoint: TransportEndpoint,
    reconnect: boolean,
  ): Promise<void> {
    // 自动重连：保留可能已被插件（如 XEP-0198 location）改写的现址
    if (reconnect) return;
    // 用户端点必须 host + port 完整，缺任一项视为未指定，交给 SRV 发现
    if (endpoint.host && endpoint.port != null) {
      // URL.hostname 会保留 IPv6 的方括号，连接前去掉
      this.host = endpoint.host.replace(/^\[|\]$/g, "");
      this.port = String(endpoint.port);
      return;
    }
    // RFC 6120 §3.2.1：SRV 记录解析；无记录时回退到 domain:默认端口
    // 直连 TLS（_xmpps-client）由发现插件直接传入端点，子类不查常规 SRV
    if (this.srvService) {
      const endpoints = await resolveSrv(`${this.srvService}.${this.domain}`);
      const endpoint = endpoints[0];
      if (endpoint) {
        this.host = endpoint.host;
        this.port = endpoint.port.toString();
        return;
      }
    }
    this.host = this.domain;
    this.port = this.defaultPort;
  }

  private setupSocketListeners(): void {
    const socket = this.socket;
    if (!socket) throw new Error("Socket未初始化");
    // "connect" / "close" 为 node net.Socket 原生事件；TLSSocket 还需等 secureConnect
    const onReady = () => {
      this.clearConnectTimer();
      log.info("连接成功");
      try {
        this.openStream();
        // 直连 TLS 已完成握手：跳过 STARTTLS 决策，直接等待认证前流特性
        if (this.readyEvent === "secureConnect") {
          this.status = Status.TLS_ESTABLISHED;
        }
      } catch (error) {
        this.handleFailure(error);
      }
    };
    if (this.readyEvent === "secureConnect") {
      (socket as TLSSocket).once("secureConnect", onReady);
    } else {
      socket.once("connect", onReady);
    }

    socket.on("data", (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString();
      // 认证阶段数据可能含 SASL challenge/success（base64），脱敏只记录长度
      if (this.status === Status.AUTHENTICATING) {
        log.debug(`收到数据（认证阶段）: ${text.length} 字节`);
      } else {
        log.debug("收到数据:", text);
      }
      this.feed(text);
    });

    socket.on("error", (error: Error) => {
      // 已被新连接替换的旧 socket：其错误不影响当前会话
      if (this.socket && this.socket !== socket) return;
      this.sink.onError(error);
      this.closeTransport();
    });

    socket.on("close", () => {
      // 已被新连接替换的旧 socket：其关闭不影响当前会话
      if (this.socket && this.socket !== socket) return;
      socket.removeAllListeners();
      this.clearConnectTimer();
      this.socket = null;
      this.onTransportClosed();
    });
  }

  /** 解析收到的原始数据（TCP 为连续流，增量喂给 parser） */
  protected feed(data: string): void {
    // 解析错误（如非法实体）是同步抛出，不会走 parser 的 error 事件，需在此兜住
    try {
      this.parser.write(data);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /** 核心处理器：stream:features:starttls —— 首次流特性：STARTTLS 决策；无 TLS 需求时直接开始 SASL */
  private async onFeaturesStartTls(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // RFC 6120 §4.3.2：stream 前缀可有可无，命名空间才是语义
    if (!isStreamFeatures(ctx.stanza)) {
      // 首次流特性之后只可能是 features；其他节交给 handleFailure 统一收尾
      throw new Error(`STARTTLS 阶段收到非流特性节: ${ctx.stanza.tagName}`);
    }
    // 如果已经是tls了，说明是直连tls的情况，直接跳过starttls
    if ((this.socket as TLSSocket)?.encrypted) {
      log.info("已是 TLS 连接，跳过 STARTTLS 协商");
      this.status = Status.TLS_ESTABLISHED;
      return;
    }
    // RFC 6120 §5.4.1：服务器宣告的 starttls 元素
    const starttls = Array.from(
      ctx.stanza.getElementsByTagName("starttls"),
    ).find((element) => element.namespaceURI === XMPPConnection.STARTTLS_NS);
    const serverRequiresTLS =
      Boolean(starttls?.getElementsByTagName("required").length);
    // 本地方针要求 TLS，或服务器强制要求 → 升级
    if (starttls && (this.tls || serverRequiresTLS)) {
      // 将状态改为 STARTTLS，后续收到 <proceed/> 由管线处理器升级 TLS
      this.status = Status.STARTTLS;
      ctx.outgoing = `<starttls xmlns='${XMPPConnection.STARTTLS_NS}'/>`;
    } else if (this.tls) {
      // 要求 TLS 但服务器未宣告 → 拒绝降级报错（由 handleFailure 统一断开）
      throw new Error("服务器未宣告 starttls 功能");
    } else {
      // 无 TLS 需求：直接开始 SASL 认证（RFC 6120 §6.4.1）
      this.status = Status.STREAM_ESTABLISHED;
      ctx.outgoing = this.startSasl(ctx.stanza);
    }
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
    // SASL 请求已发出 → 进入认证态
    if (this.status === Status.STREAM_ESTABLISHED) {
      this.status = Status.AUTHENTICATING;
    }
  }

  /** 核心处理器：starttls:proceed —— 校验并升级 TLS（RFC 6120 §5.4.2.3） */
  private async onStartTls(
    ctx: StanzaContext,
    next: () => Promise<void>,
  ): Promise<void> {
    if (ctx.stanza.localName !== "proceed") {
      throw new Error(`STARTTLS 协商失败: ${ctx.stanza.localName}`);
    }
    this.upgradeToTLS();
    return next();
  }

  /** 发送 RFC 6120 的 stream header */
  protected sendStreamOpen(): void {
    // 新流即新文档：清掉上个流残留的半解析状态（TCP 突然断开可能滞留 currentElement，重连后流头会被吞）
    this.parser.reset();
    this.send(
      `<?xml version="1.0"?><stream:stream to="${escapeXML(this.domain)}" version="1.0" xmlns="jabber:client" xmlns:stream="${XMPPConnection.STREAM_NS}">`,
    );
  }

  /** 发送 RFC 6120 的流关闭标签 */
  protected sendStreamClose(): void {
    this.send("</stream:stream>");
  }

  /** 写入 socket；写失败即断开（上层 sendAsync 由超时收尾） */
  protected writeRaw(xml: string): void {
    if (this.socket == null) throw new Error("连接已断开");
    try {
      // XMPP 消息体积小，背压时由内核缓冲，仅记录以观察写放大
      if (!this.socket.write(xml)) {
        log.debug("socket 写入缓冲已满（背压），数据已排队待发送");
      }
    } catch (error) {
      log.error("发送失败", error);
      this.disconnect();
    }
  }

  /**
   * STARTTLS 升级（RFC 6120 §5.4.3）：将现有明文 socket 包装为 TLS，
   * 握手完成后按 §5.4.3.3 重启流（重发初始 stream header）。
   */
  private upgradeToTLS(): void {
    if (!this.socket || this.socket instanceof TLSSocket) {
      throw new Error("无效的socket状态");
    }
    const plain = this.socket;
    plain.removeAllListeners();
    this.socket = tlsConnect({
      socket: plain,
      servername: this.domain,
      ALPNProtocols: ["xmpp-client"],
    });
    this.socket.setEncoding("utf8");
    this.socket.once("secureConnect", () => {
      log.info("TLS 升级成功");
      this.status = Status.TLS_ESTABLISHED;
      this.sendStreamOpen(); // 流重启
    });
    this.setupSocketListeners();
  }

  /** 关闭底层 socket；会话状态与残留清理由 socket "close" 监听统一处理 */
  protected closeTransport(): void {
    this.socket?.end();
    log.info("关闭tcp连接");
  }
}

export default XMPPConnection;
