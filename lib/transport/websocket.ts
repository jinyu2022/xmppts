import { EventEmitter } from "events";
import type { Capabilities } from "@/plugins/xep0115/entityCaps";
import { TimeoutError } from "@/errors";
import { Status } from "./typing";
import {
  SaslClient,
  SaslError,
  buildBindRequest,
  collectStreamFeatures,
  getStreamErrorCondition,
  isStreamError,
  isStreamFeatures,
  parseBindResult,
} from "./stream-negotiation";
import { XMPPElement, Parser } from "@/ltx";
import { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("WS");
const FRAMING_NS = "urn:ietf:params:xml:ns:xmpp-framing";

type BrowserWebSocket = typeof globalThis.WebSocket;
type WebSocketInstance = InstanceType<BrowserWebSocket>;

interface SocketEventMap {
  open: void;
  close: CloseEvent | undefined;
  error: Error;
  /** Auth finished; stream restart may still be in progress */
  authenticated: void;
  "stream:start": void;
  "stream:end": void;
  "stream:negotiated": void;
  stanza: XMPPElement;
  binded: void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface WSConnection {
  on<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => void,
  ): this;
  once<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => void,
  ): this;
  emit<E extends keyof SocketEventMap>(
    event: E,
    arg?: SocketEventMap[E],
  ): boolean;
  off<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => void,
  ): this;
}

/**
 * XMPP over WebSocket (RFC 7395)
 *
 * Differences vs TCP (RFC 6120):
 * - Stream open/close uses framing: <open/> / <close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>
 * - No STARTTLS; TLS is provided by wss://
 * - Each WS message is a complete XML document (not a continuous stream)
 * - Subprotocol "xmpp" is required
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class WSConnection extends EventEmitter {
  /** 当前完整 JID；绑定成功后可能被服务器改写 resource（RFC 6120 §7.7.1） */
  jid: JID;
  readonly password: string;
  private readonly domain: string;
  private ws: WebSocketInstance | null = null;
  private url?: string;
  status: (typeof Status)[keyof typeof Status] = Status.DISCONNECTED;
  streamFeatures: Set<string> = new Set();
  entityCaps?: Capabilities;
  private readonly sasl: SaslClient;
  private bindId?: string;
  private bindTimer?: ReturnType<typeof setTimeout>;

  constructor(jid: JID, password: string) {
    super();
    if (!jid.resource) {
      const resource = Math.random().toString(32).slice(2, 8);
      jid = new JID(`${jid.bare}/${resource}`);
    }
    this.jid = jid;
    this.domain = jid.domain;
    this.password = password;
    this.sasl = new SaslClient(jid);
  }

  async connect(url?: string) {
    if (url) {
      this.url = url;
    }
    if (!this.url) throw new Error("missing websocket url");

    const WSCtor = await this.resolveWebSocket();
    this.status = Status.CONNECTING;
    this.ws = new WSCtor(this.url, "xmpp");
    log.debug("connecting", this.url);

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

  private onOpen() {
    log.debug("open");
    this.status = Status.CONNECTED;
    this.sendOpen();
    this.status = Status.STREAM_START;
    this.emit("open");
  }

  private onClose(ev: CloseEvent) {
    if (this.status !== Status.SESSIONEND) {
      this.status = Status.SESSIONEND;
      this.emit("stream:end");
    }
    this.status = Status.DISCONNECTED;
    log.debug("ws close", ev.code, ev.reason);
    this.emit("close", ev);
  }

  private onMessage(ev: MessageEvent) {
    const data =
      typeof ev.data === "string"
        ? ev.data
        : Buffer.isBuffer(ev.data)
          ? ev.data.toString("utf8")
          : String(ev.data);
    log.debug("recv", data);

    // RFC 7395: each WebSocket message is one complete XML document.
    try {
      const stanza = Parser.parse(data);
      void this.onStanza(stanza);
    } catch (error) {
      log.error("parse failed", error, data);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private onError() {
    const err = new Error("WebSocket error");
    log.error("error", err);
    this.emit("error", err);
  }

  private async onStanza(stanza: XMPPElement): Promise<void> {
    try {
      if (stanza.localName === "open" && stanza.namespaceURI === FRAMING_NS) {
        log.info("framing open received");
        return;
      }
      if (stanza.localName === "close" && stanza.namespaceURI === FRAMING_NS) {
        log.info("server closed framing stream");
        this.status = Status.SESSIONEND;
        this.emit("stream:end");
        this.close();
        return;
      }
      if (await this.handleLogin(stanza)) return;
      this.emit("stanza", stanza);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      log.error("negotiation failed", failure);
      this.status = failure instanceof SaslError
        ? Status.AUTHFAIL
        : Status.ERROR;
      this.emit("error", failure);
      this.disconnect();
    }
  }

  private async handleLogin(stanza: XMPPElement): Promise<boolean> {
    if (isStreamError(stanza)) {
      throw new Error(`流错误: ${getStreamErrorCondition(stanza)}`);
    }

    if (this.status === Status.STREAM_START && isStreamFeatures(stanza)) {
      this.status = Status.STREAM_ESTABLISHED;
      this.send(this.sasl.start(stanza, this.password));
      this.status = Status.AUTHENTICATING;
      return true;
    }

    if (this.status === Status.AUTHENTICATING) {
      const result = await this.sasl.process(stanza, this.password);
      if (result.type === "send") this.send(result.data);
      if (result.type === "success") {
        this.status = Status.AUTHENTICATED;
        this.emit("authenticated");
        this.sendOpen();
      }
      return true;
    }

    if (this.status === Status.AUTHENTICATED && isStreamFeatures(stanza)) {
      const features = collectStreamFeatures(stanza);
      this.streamFeatures = features.namespaces;
      this.entityCaps = features.entityCaps;
      this.emit("stream:negotiated");
      if (stanza.getElementsByTagName("bind").length > 0) {
        this.startBind();
      }
      return true;
    }

    if (this.status === Status.BINDING && stanza.getAttribute("id") === this.bindId) {
      this.finishBind(stanza);
      return true;
    }
    return this.status < Status.BINDED;
  }

  private startBind(): void {
    const request = buildBindRequest(this.jid.resource);
    this.bindId = request.id;
    this.status = Status.BINDING;
    this.send(request.data);
    this.bindTimer = setTimeout(() => {
      this.bindTimer = undefined;
      this.bindId = undefined;
      this.status = Status.ERROR;
      const error = new TimeoutError(`请求超时: ${request.id}`);
      this.emit("error", error);
      this.disconnect();
    }, 30000);
    this.bindTimer?.unref?.();
  }

  private finishBind(response: XMPPElement): void {
    if (this.bindTimer) clearTimeout(this.bindTimer);
    this.bindTimer = undefined;
    this.bindId = undefined;
    this.jid = parseBindResult(response, this.jid.bare);
    this.status = Status.BINDED;
    this.emit("binded");
  }

  /** RFC 7395 stream open */
  private sendOpen(): void {
    this.writeRaw(
      `<open to="${this.domain}" version="1.0" xmlns="${FRAMING_NS}"/>`,
    );
    this.emit("stream:start");
  }

  private writeRaw(data: string): void {
    if (!this.ws) {
      throw new Error("not connected");
    }
    if (this.ws.readyState !== 1 /* OPEN */) {
      throw new Error("websocket not open");
    }
    log.debug("send", data);
    this.ws.send(data);
  }

  send(data: string | XMPPElement): void {
    this.writeRaw(typeof data === "string" ? data : data.toXMLString());
  }

  private close() {
    if (this.bindTimer) clearTimeout(this.bindTimer);
    this.bindTimer = undefined;
    this.bindId = undefined;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.close();
    }
    this.ws = null;
  }

  /** Close XMPP framing stream then WebSocket (RFC 7395 §3.6) */
  disconnect() {
    try {
      this.writeRaw(`<close xmlns="${FRAMING_NS}"/>`);
    } catch {
      // already closed
    }
    this.status = Status.SESSIONEND;
    this.emit("stream:end");
    this.close();
    log.debug("disconnected");
  }
}

export default WSConnection;
