import { Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { EventEmitter } from "node:events";
import { resolveSrv } from "../dns";
import { XMPPElement, Parser, escapeXML } from "@/ltx";
import { TimeoutError } from "@/errors";
import type { Capabilities } from "@/plugins/xep0115/entityCaps";
import { Status } from "./typing";
import { Pipeline } from "./pipeline";
import {
  BIND_NS,
  SaslClient,
  SaslError,
  collectStreamFeatures,
  getStreamErrorCondition,
  isStreamError,
  isStreamFeatures,
  parseBindResult,
} from "./stream-negotiation";
import { JID } from "../JID";
import logger from "@/log";

const log = logger.getLogger("tcp");

/** 连接配置载荷：ctx 仅向管线传递引用，连接层不读取其字段 */
interface ConnectContext {
  /** 目标域名（只读） */
  readonly domain: string;
  /** 是否使用 TLS（只读） */
  readonly tls: boolean;
  /** 连接地址（可读；补全请走参数或由插件自行处理） */
  url?: string;
  /** 引用出口：中间件经此直接替换连接实例的 socket */
  setSocket?: (socket: Socket | TLSSocket) => void;
}

/** 协商阶段最小载荷：仅当前 stanza（只读消费） */
interface StanzaContext {
  readonly stanza: XMPPElement;
}

/** 决策类协商载荷：处理器写回 `outgoing`，由连接层统一发送 */
export interface SendContext extends StanzaContext {
  outgoing?: XMPPElement | string;
}

/** 绑定/恢复响应载荷：`status` 经访问器映射连接实例状态，插件改写即生效 */
export interface BindingContext extends SendContext {
  /** 连接状态（读写连接实例，非载荷副本） */
  status: (typeof Status)[keyof typeof Status];
}

/** 传输层管线事件映射：连接全生命周期阶段均通过管线触发，各事件仅暴露该阶段所需字段 */
export type TransportPipelineEvents = {
  /** 解析端点/创建 socket 之前：可补全 url、修改连接配置 */
  "beforeConnect": ConnectContext;
  /** 首次流特性（含 `<starttls/>`）：STARTTLS 决策 */
  "stream:features:starttls": SendContext;
  /** TLS 建立后（STARTTLS 升级或直连 TLS）收到含 `<mechanisms/>` 的流特性：SASL 决策 */
  "stream:features:mechanisms": SendContext;
  /** 收到 `<proceed/>`：校验并升级 TLS，处理器拒绝降级 */
  "starttls:proceed": StanzaContext;
  /** SASL 认证流程：challenge 应答 / success 完成 / failure 抛错，均经此事件 */
  sasl: SendContext;
  /** 认证后流特性：`outgoing` 预填资源绑定请求，插件可改写以改发（如 XEP-0198 会话恢复） */
  "stream:negotiated": SendContext & { outgoing?: string };
  /** 绑定/恢复请求的响应：处理器可处理自己改发的请求，并可写回 `outgoing` 发送下一条请求，`status` 为连接状态访问器 */
  binding: BindingContext;
  };

interface SocketEventMap {
  open: void;
  close: void;
  error: Error;
  authenticated: void;
  "stream:start": void;
  "stream:end": void;
  stanza: XMPPElement;
  binded: void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface XMPPConnection {
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
 * XMPP 明文 TCP / STARTTLS 连接（RFC 6120）。
 *
 * 连接全生命周期通过 {@link Pipeline} 驱动：连接层在固定阶段调用
 * `pipeline.run()`，协商逻辑以核心处理器（构造函数注册）实现，
 * 插件可在同一事件点注册观察/介入处理器。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class XMPPConnection extends EventEmitter {
  // NOSONAR: RFC 6120 固定的 XML 命名空间标识符，不是网络请求地址。
  static readonly STREAM_NS = "http://etherx.jabber.org/streams";
  static readonly STARTTLS_NS = "urn:ietf:params:xml:ns:xmpp-tls";
  /** 当前完整 JID；绑定成功后可能被服务器改写 resource（RFC 6120 §7.7.1） */
  jid: JID;
  private readonly password: string;
  private socket: Socket | TLSSocket | null = null;
  private readonly domain: string;
  host: string;
  port = "5222";
  /** 是否使用 TLS（直连 TLS / 非 STARTTLS 升级路径） */
  private readonly tls: boolean;
  status: (typeof Status)[keyof typeof Status] = Status.DISCONNECTED;
  streamFeatures: Set<string> = new Set();
  entityCaps?: Capabilities;
  /** 连接管线：全部连接/协商/断开阶段在此流转 */
  readonly pipeline = new Pipeline<TransportPipelineEvents>();
  private readonly parser: Parser;
  private readonly sasl: SaslClient;
  private bindId?: string;
  private bindTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;

  constructor(jid: JID, password: string, tls = true) {
    super();
    if (!jid.resource) {
      // NOSONAR: 资源名仅需唯一性，无需加密安全
      jid = new JID(`${jid.bare}/${Math.random().toString(32).slice(2, 8)}`);
    }
    this.jid = jid;
    this.password = password;
    this.tls = tls;
    this.domain = jid.domain;
    this.host = jid.domain;
    this.parser = new Parser();
    // parser 跨连接复用（重连/STARTTLS 不重建），监听器仅注册一次，避免重复注册与误删
    this.parser.on("tree", (stanza) => {
      log.debug("解析到完整stanza:", stanza.tagName);
      void this.onStanza(stanza);
    });
    // 对端关闭流（</stream:stream>）：按 RFC 6120 §4.4 回发流尾，再关闭本端 socket，避免半开悬挂
    this.parser.on("streamEnd", () => {
      if (this.status !== Status.SESSIONEND) {
        this.status = Status.SESSIONEND;
        try {
          this.send("</stream:stream>");
        } catch (error) {
          log.warn("回发流关闭标签失败，可能是连接已断开", error);
        }
        this.emit("stream:end");
      }
      this.close();
    });
    // 无 error 监听时 emit('error') 会以未捕获异常崩溃进程（服务端畸形 XML 可触发）
    this.parser.on("error", (error) => this.handleFailure(error));
    this.sasl = new SaslClient(jid);

    // 核心协商处理器最先注册，先于插件的观察/介入处理器执行
    this.pipeline
      .use("stream:features:starttls", this.onFeaturesStartTls.bind(this))
      .use("stream:features:mechanisms", this.onFeaturesMechanisms.bind(this))
      .use("starttls:proceed", this.onStartTls.bind(this))
      // SASL 认证整条流程共用同一事件，由 onSasl 统一处理
      .use("sasl", this.onSasl.bind(this))
      .use("stream:negotiated", this.onNegotiated.bind(this))
      .use("binding", this.onBinding.bind(this));
  }

  /**
   * 连接，为空时从 SRV 记录解析端点
   * @param url 完整的连接地址
   */
  async connect(url?: string) {
    // 防重复连接：入口即检查并同步占位 CONNECTING，并发调用在此快速失败，
    // 避免各自越过守卫后重复注册 socket 监听、泄漏双 socket
    if (this.status !== Status.DISCONNECTED) {
      throw new Error("连接已在进行中，请先 disconnect() 再重连");
    }
    this.status = Status.CONNECTING;

    // 引用对象：中间件经 ctx.url / ctx.setSocket 直接修改连接配置，连接层只读局部变量
    let targetUrl = url;
    const ctx = {
      domain: this.domain,
      tls: this.tls,
      get url() {
        return targetUrl;
      },
      set url(value) {
        targetUrl = value;
      },
      setSocket: (socket: Socket | TLSSocket) => {
        if (this.socket) throw new Error("Socket 已存在，无法替换");
        this.socket = socket;
      },
    };
    try {
      await this.pipeline.run("beforeConnect", ctx);

      if (targetUrl) {
        const parsed = new URL(targetUrl);
        this.host = parsed.hostname.replace(/^\[|\]$/g, "");
        // URL 无显式端口时 port 为空串，回退到协议默认端口
        this.port = parsed.port || "5222";
      } else { 
        // RFC 6120 §3.2.1：SRV 记录解析；无记录时回退到 domain:5222
        // 直连 TLS（_xmpps-client）由 XEP-0368 插件介入
        const endpoints = await resolveSrv(`_xmpp-client._tcp.${this.domain}`);
        const endpoint = endpoints[0];
        if (endpoint) {
          this.host = endpoint.host;
          this.port = endpoint.port.toString();
        } else {
          this.host = this.domain;
          this.port = "5222";
        }
      }
      // socket 优先由中间件 setSocket 注入，未注入时创建默认明文 Socket（RFC 6120）
      // keepAlive 属 net.Socket 构造选项，connect() 的选项不支持
      this.socket ??= new Socket({ keepAlive: true });
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
        this.emit(
          "error",
          new TimeoutError(
            `连接超时: ${this.host}:${this.port}（30 秒内未建立连接）`,
          ),
        );
      }, 30_000);
      this.connectTimer?.unref?.();
      this.socket.once("connect", () => this.clearConnectTimer());
    } catch (error) {
      // 回滚：半初始化的 socket 一并销毁，避免残留监听器与下次 connect() 复用
      this.socket?.removeAllListeners();
      this.socket?.destroy();
      this.socket = null;
      this.clearConnectTimer();
      this.status = Status.DISCONNECTED;
      throw error;
    }

    log.info(`正在连接 ${this.host}:${this.port}`);
  }

  /** 清除连接超时定时器（C1：connect/error/close 统一清理，避免残留定时器误杀重连） */
  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private setupSocketListeners(): void {
    const socket = this.socket;
    if (!socket) throw new Error("Socket未初始化");
    // "connect" / "close" 为 node net.Socket 原生事件
    socket.once("connect", () => {
      log.info("连接成功");
      try {
        this.openStream();
      } catch (error) {
        this.handleFailure(error);
      }
    });

    socket.on("data", (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString();
      // 认证阶段数据可能含 SASL challenge/success（base64），脱敏只记录长度
      if (this.status === Status.AUTHENTICATING) {
        log.debug(`收到数据（认证阶段）: ${text.length} 字节`);
      } else {
        log.debug("收到数据:", text);
      }
      // 解析错误（如非法实体）是同步抛出，不会走 parser 的 error 事件，需在此兜住
      try {
        this.parser.write(text);
      } catch (error) {
        this.handleFailure(error);
      }
    });

    socket.on("error", (error: Error) => {
      // 已被新连接替换的旧 socket：其错误不影响当前会话
      if (this.socket && this.socket !== socket) return;
      this.emit("error", error);
      this.close();
    });

    socket.on("close", () => {
      // 已被新连接替换的旧 socket：其关闭不影响当前会话
      if (this.socket && this.socket !== socket) return;
      if (this.status !== Status.SESSIONEND) {
        this.status = Status.SESSIONEND;
        this.emit("stream:end");
      }
      socket.removeAllListeners();
      this.status = Status.DISCONNECTED;
      this.socket = null;
      // 会话残留统一在此清理：定时器、绑定请求、能力缓存与 SASL 中间状态
      this.clearConnectTimer();
      if (this.bindTimer) clearTimeout(this.bindTimer);
      this.bindTimer = undefined;
      this.bindId = undefined;
      this.streamFeatures.clear();
      this.entityCaps = undefined;
      this.sasl.reset();
      this.emit("close");
    });
  }

  private async onStanza(stanza: XMPPElement): Promise<void> {
    try {
      if (isStreamError(stanza)) {
        throw new Error(`流错误: ${getStreamErrorCondition(stanza)}`);
      }
      // 协商与业务 stanza 统一由 route 分发
      await this.route(stanza);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /** 协商失败统一处理：标记状态、上报错误并断开 */
  private handleFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    // 错误日志由连接层在 'error' 监听中统一输出，避免两层重复
    // 以错误类别（SaslError）而非消息文案判断认证失败，避免文案变更破坏逻辑
    this.status = failure instanceof SaslError ? Status.AUTHFAIL : Status.ERROR;
    this.emit("error", failure);
    this.disconnect();
  }

  /** 分发入口：协商阶段 stanza 走对应管线事件，其余（业务 stanza）投递到 stanza 事件 */
  private async route(stanza: XMPPElement): Promise<void> {
    // 每个阶段构造各自的最小载荷：处理器共享同一引用，决策类事件写回 outgoing
    switch (this.status) {
      // 首次流特性：STARTTLS 决策；无 TLS 需求时直接开始 SASL
      case Status.STREAM_START:
        /** {@link onFeaturesStartTls} */
        await this.pipeline.run("stream:features:starttls", { stanza });
        return;
      // STARTTLS 协商：<proceed/> 由处理器校验
      case Status.STARTTLS:
        await this.pipeline.run("starttls:proceed", { stanza });
        return;
      // TLS 已建立（STARTTLS 升级 / XEP-0368 直连）后的流特性：直接 SASL 决策
      case Status.TLS_ESTABLISHED:
        /** {@link onFeaturesMechanisms} */
        await this.pipeline.run("stream:features:mechanisms", { stanza });
        return;
      // 认证中：challenge / success / failure 均走同一认证事件，由 onSasl 统一处理
      case Status.AUTHENTICATING:
        /** {@link onSasl} */
        await this.pipeline.run("sasl", { stanza });
        return;
      // 认证后再次收到 features：解析能力并触发资源绑定
      case Status.AUTHENTICATED:
        /**{@link onNegotiated} */
        await this.pipeline.run("stream:negotiated", { stanza });
        return;
      // 绑定/恢复请求的响应：交由 binding 事件管线处理
      case Status.BINDING:{
        const ctx = { stanza, status: this.status };
        Object.defineProperty(ctx, "status", {
          get: () => this.status,
          set: (value: (typeof Status)[keyof typeof Status]) => { this.status = value },
          enumerable: true,
        });
        await this.pipeline.run("binding", ctx);
        // this.status = ctx.status; // 处理器可改写连接状态
        return;
      }
      // 其余状态（含 BINDED 后的业务 stanza）：投递到 stanza 事件
      default:
        this.emit("stanza", stanza);
    }
  }

  /** TCP 建立：发送流头并根据 socket 类型确定协商起点 */
  private openStream(): void {
    this.status = Status.CONNECTED;
    this.sendStreamHeader();
    this.status = Status.STREAM_START;
    this.emit("open");
  }

  /** 核心处理器：stream:features:starttls —— 首次流特性：STARTTLS 决策；无 TLS 需求时直接开始 SASL */
  private async onFeaturesStartTls(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // RFC 6120 §4.3.2：stream 前缀可有可无，命名空间才是语义
    if (!isStreamFeatures(ctx.stanza)) {
      return
    }
    // 如果已经是tls了，说明是直连tls的情况，直接跳过starttls
    if ((this.socket as TLSSocket)?.encrypted) {
      log.info("已是 TLS 连接，跳过 STARTTLS 协商");
      this.status = Status.TLS_ESTABLISHED;
      return;
    }
    // RFC 6120 §5.4.1：服务器宣告的 starttls 元素
    const starttls = ctx.stanza
      .getElementsByTagName("starttls")
      .find((element) => element.namespaceURI === XMPPConnection.STARTTLS_NS);
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
      ctx.outgoing = this.sasl.start(ctx.stanza, this.password);
    }
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
    // SASL 请求已发出 → 进入认证态
    if (this.status === Status.STREAM_ESTABLISHED) {
      this.status = Status.AUTHENTICATING;
    }
  }

  /** 核心处理器：stream:features:mechanisms —— TLS 已建立（升级或直连），直接开始 SASL 认证 */
  private async onFeaturesMechanisms(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    if (!isStreamFeatures(ctx.stanza)) {
      return next();
    }
    this.status = Status.STREAM_ESTABLISHED;
    ctx.outgoing = this.sasl.start(ctx.stanza, this.password);
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
    this.status = Status.AUTHENTICATING;
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

  /** 核心处理器：sasl —— 统一处理认证流程（challenge 应答 / success 完成，failure 在 sasl.process 中抛出） */
  private async onSasl(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    const result = await this.sasl.process(ctx.stanza, this.password);
    if (result.type === "send") {
      ctx.outgoing = result.data;
    } else if (result.type === "success") {
      this.status = Status.AUTHENTICATED;
      this.emit("authenticated");
      this.sendStreamHeader(); // 流重启（RFC 6120 §6.4.5）
    }
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
  }

  /** 核心处理器：stream:negotiated —— 收集能力，并预填资源绑定请求（插件可整体替换以改发） */
  private async onNegotiated(
    ctx: SendContext & { outgoing?: string },
    next: () => Promise<void>,
  ): Promise<void> {
    // 判断是否为流特性 stanza（RFC 6120 §4.3.2）
    if (!isStreamFeatures(ctx.stanza)) {
      return next();
    }
    const features = collectStreamFeatures(ctx.stanza);
    this.streamFeatures = features.namespaces;
    this.entityCaps = features.entityCaps;
    // this.emit("stream:negotiated");
    // 资源名可能含 XML 特殊字符，需转义；未指定资源时省略该元素由服务器分配（RFC 6120 §7.7.1）
    const resourceElement = this.jid.resource
      ? `<resource>${escapeXML(this.jid.resource)}</resource>`
      : "";
    // 预填绑定请求：插件可在管线中整体替换 outgoing 改发（如 XEP-0198 的 <resume/>）
    if (ctx.stanza.getElementsByTagNameNS(BIND_NS, "bind").length > 0) {
      // 记录请求 id，供 onBinding 匹配响应；插件替换 outgoing 时该 id 仍用于恢复失败回退
      this.bindId = crypto.randomUUID();
      ctx.outgoing = `<iq type='set' id='${this.bindId}'><bind xmlns='${BIND_NS}'>${resourceElement}</bind></iq>`;
    }
    await next();
    if (!ctx.outgoing) return;
    // 插件改发的请求：响应按 stanza 透传给插件，超时由插件自管
    this.status = Status.BINDING;
    this.send(ctx.outgoing);
    // todo 做一个通用的超时器
    // this.bindTimer = setTimeout(() => {
    //   this.bindTimer = undefined;
    //   this.bindId = undefined;
    //   this.status = Status.ERROR;
    //   this.emit("error", new TimeoutError(`请求超时: ${id}`));
    //   this.disconnect();
    //   // NOSONAR: 定时器不阻塞进程退出（可被 unref 的定时器仍会被 clearTimeout 清理）
    // }, 30000).unref?.();
  }

  /** 核心处理器：binding —— 匹配绑定响应并直接处理结果；其余响应（插件改发的请求）放行给插件 */
  private async onBinding(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    const { stanza } = ctx;
    const iqType = stanza.getAttribute("type");
    const isBindResponse =
      stanza.tagName === "iq" &&
      (iqType === "result" || iqType === "error") &&
      stanza.getAttribute("id") === this.bindId;
    if (isBindResponse) {
      // 绑定结果：成功解析绑定 JID，iq error 由 parseBindResult 抛错
      if (this.bindTimer) clearTimeout(this.bindTimer);
      this.bindTimer = undefined;
      this.bindId = undefined;
      this.jid = parseBindResult(stanza, this.jid.bare);
      this.status = Status.BINDED;
    }
    // 非绑定响应（如插件改发 <resume/> 的回复）：先放行给插件处理
    await next();
    if (this.status === Status.BINDED) this.emit("binded");
    // XEP0198 需要：会话恢复被拒时写回原绑定请求，由连接层代发
    if (ctx.outgoing) this.send(ctx.outgoing);
    // 无人消费的非绑定响应广播到 stanza 事件，避免静默丢弃
    if (!isBindResponse) this.emit("stanza", stanza);
  }

  /** 发出资源绑定请求；插件（如 XEP-0198 恢复失败）也可调用以回退常规绑定 */
  startBind(): void {
    const id = `bind-${crypto.randomUUID()}`;
    const { resource } = this.jid;
    // 资源名可能含 XML 特殊字符，需转义；未指定资源时省略该元素由服务器分配（RFC 6120 §7.7.1）
    const resourceElement = resource
      ? `<resource>${escapeXML(resource)}</resource>`
      : "";
    const xml = `<iq type='set' id='${id}'><bind xmlns='${BIND_NS}'>${resourceElement}</bind></iq>`;
    this.bindId = id;
    this.status = Status.BINDING;
    this.send(xml);
    this.bindTimer = setTimeout(() => {
      this.bindTimer = undefined;
      this.bindId = undefined;
      this.status = Status.ERROR;
      this.emit("error", new TimeoutError(`请求超时: ${id}`));
      this.disconnect();
      // NOSONAR: 定时器不阻塞进程退出（可被 unref 的定时器仍会被 clearTimeout 清理）
    }, 30000);
    this.bindTimer?.unref?.();
  }

  /** 会话恢复成功（XEP-0198）：沿用原绑定，直接标记会话可用 */
  resumeSession(): void {
    this.status = Status.BINDED;
    this.emit("binded");
  }

  /** 发送 RFC 6120 的 stream header */
  private sendStreamHeader(): void {
    // 新流即新文档：清掉上个流残留的半解析状态（TCP 突然断开可能滞留 currentElement，重连后流头会被吞）
    this.parser.reset();
    this.send(
      `<?xml version="1.0"?><stream:stream to="${escapeXML(this.domain)}" version="1.0" xmlns="jabber:client" xmlns:stream="${XMPPConnection.STREAM_NS}">`,
    );
    this.emit("stream:start");
  }

  /**
   * 写入数据到底层 socket
   * @param data 数据，若为 string，则直接发送
   */
  send(data: string | XMPPElement): void {
    if (this.socket == null) throw new Error("连接已断开");
    const xml = typeof data === "string" ? data : data.toXMLString();
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
      this.sendStreamHeader(); // 流重启
    });
    this.setupSocketListeners();
  }

  async reconnect(): Promise<void> {
    // 防重复连接：入口即检查并同步占位 CONNECTING，并发调用在此快速失败，
    // 避免各自越过守卫后重复注册 socket 监听、泄漏双 socket
    if (this.status !== Status.DISCONNECTED) {
      throw new Error("连接已在进行中，请先 disconnect() 再重连");
    }
    this.status = Status.RECONNECTING;
    const ctx = {
      domain: this.domain,
      tls: this.tls,
      setSocket: (socket: Socket | TLSSocket) => {
        if (this.socket) throw new Error("Socket 已存在，无法替换");
        this.socket = socket;
      },
    };
    try {
      await this.pipeline.run("beforeConnect", ctx);

      // socket 优先由中间件 setSocket 注入，未注入时创建默认明文 Socket（RFC 6120）
      // keepAlive 属 net.Socket 构造选项，connect() 的选项不支持
      this.socket ??= new Socket({ keepAlive: true });
      this.socket.setEncoding("utf8");
      // 解除上个对象的监听器应该由onclose处理，避免重复注册与误删
      this.setupSocketListeners();
      // pending=未连上 connecting=无人拨号 → 仅"未拨号"socket 由连接层拨号
      if (this.socket.pending && !this.socket.connecting)
        this.socket.connect(Number.parseInt(this.port), this.host);
      // 连接建立超时：30 秒未建立则放弃本次连接；状态与残留由 socket "close" 监听统一清理
      this.connectTimer = setTimeout(() => {
        if (this.status === Status.DISCONNECTED) return; // 已建立或已断开，不重复处理
        // 挂起的 socket 调 end() 不会立即关闭，销毁以尽快触发 close 事件
        this.socket?.destroy();
        this.emit(
          "error",
          new TimeoutError(
            `连接超时: ${this.host}:${this.port}（30 秒内未建立连接）`,
          ),
        );
      }, 30_000);
      this.connectTimer?.unref?.();
      this.socket.once("connect", () => this.clearConnectTimer());
    } catch (error) {
      // 回滚：半初始化的 socket 一并销毁，避免残留监听器与下次 reconnect() 复用
      this.socket?.removeAllListeners();
      this.socket?.destroy();
      this.socket = null;
      this.clearConnectTimer();
      this.status = Status.DISCONNECTED;
      throw error;
    }

    log.info(`正在连接 ${this.host}:${this.port}`);
  }

  disconnect() {
    // 幂等守卫：未连接或已断开时直接返回，避免重复关闭事件
    if (
      this.status === Status.DISCONNECTED ||
      this.status === Status.SESSIONEND ||
      this.socket == null
    ) {
      return;
    }
    try {
      this.send("</stream:stream>");
    } catch (error) {
      log.warn("发送流关闭标签失败，可能是连接已断开", error);
      // 连接可能已断开
    }
    log.info("关闭XMPP流");
    this.status = Status.SESSIONEND;
    this.emit("stream:end");
    this.close();
  }

  /** 关闭底层 socket；会话状态与残留清理由 socket "close" 监听统一处理 */
  private close(): void {
    this.socket?.end();
    log.info("关闭tcp连接");
  }
}

export default XMPPConnection;
