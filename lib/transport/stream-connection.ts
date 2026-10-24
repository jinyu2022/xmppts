import { XMPPElement } from "@/ltx";
import { JID } from "@/JID";
import { generateSecureNonce } from "@/auth/scram";
import { SaslClient, SASL_NS, type SaslEvent } from "@/auth/sasl";
import { ProtocolError, XMPPError } from "@/errors";
import logger from "@/log";
import { Status, type TransportSink, type TransportSocket } from "./typing";
import { Pipeline } from "./pipeline";

const log = logger.getLogger("stream");

/** 资源绑定命名空间 (RFC 6120 §7) */
export const BIND_NS = "urn:ietf:params:xml:ns:xmpp-bind";
// NOSONAR: RFC 6120 固定的 XML 命名空间标识符，不是网络请求地址。
export const STREAM_NS = "http://etherx.jabber.org/streams";

/** 流协商看门狗超时：与 connectTimer / sendAsync 默认值保持一致（30s） */
const NEGOTIATION_TIMEOUT = 30_000;

/**
 * 判断 stanza 是否为流特性宣告 (<features> / <stream:features>)。
 * 前缀可有可无，命名空间才是语义（RFC 6120 §4.3.2）。
 */
export function isStreamFeatures(stanza: XMPPElement): boolean {
  return stanza.localName === "features" && stanza.namespaceURI === STREAM_NS;
}

/**
 * 判断 stanza 是否为流错误 (<error> / <stream:error>)。
 * 前缀可有可无，命名空间才是语义（RFC 6120 §4.9）。
 */
export function isStreamError(stanza: XMPPElement): boolean {
  return stanza.localName === "error" && stanza.namespaceURI === STREAM_NS;
}

/** 从流特性宣告中收集所有命名空间。 */
export function collectStreamFeatures(features: XMPPElement): Set<string> {
  const namespaces = new Set<string>();

  for (const feature of features.childNodes) {
    if (!(feature instanceof XMPPElement) || !feature.namespaceURI) continue;
    namespaces.add(feature.namespaceURI);
  }

  return namespaces;
}

/**
 * 识别服务器的 SASL 节并解析为协议事件 (RFC 6120 §6.4)。
 * 非 SASL 命名空间的节返回 undefined，由调用方放行。
 *
 * @param stanza 服务器发来的 stanza
 */
export function parseSaslEvent(stanza: XMPPElement): SaslEvent | undefined {
  if (stanza.namespaceURI !== SASL_NS) return undefined;
  switch (stanza.localName) {
    case "challenge":
      return { type: "challenge", payload: stanza.textContent };
    case "success":
      return { type: "success", payload: stanza.textContent };
    case "failure": {
      // 规范要求 failure 至少包含一个条件元素（RFC 6120 §6.5.2）；
      // 条件同样是 failure 自身的子元素，不是 stanza 错误的 `<error/>`
      return {
        type: "failure",
        condition: stanza.firstElementChild?.localName ?? "not-authorized",
      };
    }
    default:
      return undefined;
  }
}

/**
 * 构建资源绑定 IQ (RFC 6120 §7)。
 * 生成形如 `<iq type="set" id="bind-xxx"><bind xmlns="..."/></iq>` 的请求。
 *
 * @param resource 可选的资源标识符，不传则由服务器自动分配
 */
export function buildBindRequest(resource?: string) {
  const id = `bind-${generateSecureNonce(8)}`;
  const iq = XMPPElement.createElement("iq", { type: "set", id });

  const bind = XMPPElement.createElementNS(BIND_NS, "bind");
  if (resource) {
    const resourceElement = XMPPElement.createElement("resource");
    resourceElement.textContent = resource;
    bind.appendChild(resourceElement);
  }
  iq.appendChild(bind);
  return { id, data: iq.toXMLString() };
}

/**
 * 解析资源绑定结果 IQ，验证并返回绑定的完整 JID。
 *
 * @param response 服务器返回的 IQ stanza
 * @param expectedBareJid 期望的 bare JID（用于一致性校验）
 * @throws 当绑定失败、返回非法 JID 或与期望身份不匹配时
 */
export function parseBindResult(
  response: XMPPElement,
  expectedBareJid: string,
): JID {
  const type = response.getAttribute("type");
  // 服务器返回错误：错误节交给 XMPPError 解析（RFC 6120 §8.3.2）
  if (type === "error") {
    const error = new XMPPError(response, "资源绑定失败");
    error.message = `${error.message}: ${error.condition ?? "unknown"}`;
    throw error;
  }
  if (type !== "result") {
    throw new Error(`资源绑定失败: 意外的 IQ type=${type ?? "null"}`);
  }

  const jidText = response.getElementsByTagName("jid")[0]?.textContent?.trim();
  if (!jidText) throw new Error("资源绑定失败: 响应缺少 jid");

  // 验证 JID 合法性
  let bound: JID;
  try {
    bound = new JID(jidText);
  } catch {
    throw new Error(`资源绑定失败: 非法 jid ${jidText}`);
  }
  // 防止服务器返回与认证身份不一致的 JID（安全校验）
  if (bound.bare !== expectedBareJid) {
    throw new Error(
      `资源绑定失败: 返回 JID ${bound.bare} 与认证身份 ${expectedBareJid} 不一致`,
    );
  }
  return bound;
}

/** 协商阶段最小载荷：仅当前 stanza（只读消费） */
export interface StanzaContext {
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

/**
 * XMPP 传输连接基类：承载与传输方式无关的流协商与状态机。
 *
 * 子类只负责传输差异：
 * - {@link openTransport} 建立底层连接（TCP socket / WebSocket）
 * - {@link feed} 把收到的原始数据解析后交给 {@link handleStanza}
 * - {@link writeRaw}、{@link sendStreamOpen}、{@link sendStreamClose}、{@link closeTransport}
 *   提供该传输的帧写出、流开启/关闭与关闭操作
 *
 * 流特性（SASL/绑定）、状态流转、超时与错误收尾均在此实现，
 * 参考 xmpp.js 的 Connection 基类 + ConnectionTCP 子类分层。
 */
export abstract class StreamConnection implements TransportSocket {
  /** 当前完整 JID；绑定成功后可能被服务器改写 resource（RFC 6120 §7.7.1） */
  jid: JID;
  /** 目标域名 */
  protected readonly domain: string;
  /** 登录密码，仅用于 SASL 计算 */
  protected readonly password: string;
  /** 底层传输主机（WebSocket 传输为 URL 的 hostname） */
  abstract host: string;
  /** 底层传输端口（WebSocket 传输为 URL 的 port） */
  abstract port: string;
  /** 当前连接状态，流转见 {@link Status} */
  status: (typeof Status)[keyof typeof Status] = Status.DISCONNECTED;
  /** 服务器宣告的流特性命名空间集合 */
  streamFeatures: Set<string> = new Set();
  /** 连接管线：全部连接/协商/断开阶段在此流转 */
  readonly pipeline = new Pipeline<TransportPipelineEvents>();
  /** TCP 与 WebSocket 共用的 SASL 客户端 */
  protected readonly sasl: SaslClient;
  /** 资源绑定请求 id，用于匹配响应 */
  private bindId?: string;
  /** 流协商看门狗；非 undefined 表示仍在协商阶段 */
  private negotiationTimer?: ReturnType<typeof setTimeout>;
  /** 连接建立超时定时器（由子类在拨号时设置） */
  protected connectTimer?: ReturnType<typeof setTimeout>;
  /** 上层通知接收者；构造时注入，生命周期与实例一致 */
  protected readonly sink: TransportSink;

  protected constructor(jid: JID, password: string, sink: TransportSink) {
    this.sink = sink;
    if (!jid.resource) {
      // 未指定资源时随机生成；服务器可在绑定结果中改写（RFC 6120 §7.7.1）
      // NOSONAR: 资源名仅需唯一性，无需加密安全
      jid = new JID(`${jid.bare}/${Math.random().toString(32).slice(2, 8)}`);
    }
    this.jid = jid;
    this.password = password;
    this.domain = jid.domain;
    this.sasl = new SaslClient(jid);

    // 认证与绑定流程与传输无关：核心处理器先注册，先于插件的观察/介入处理器执行
    this.pipeline
      .use("stream:features:mechanisms", this.onFeaturesMechanisms.bind(this))
      .use("sasl", this.onSasl.bind(this))
      .use("stream:negotiated", this.onNegotiated.bind(this))
      .use("binding", this.onBinding.bind(this));
  }

  // ---------------------------------------------------------------------------
  // 子类需实现的传输差异
  // ---------------------------------------------------------------------------

  /**
   * 建立底层连接：解析端点、创建 socket/WebSocket、挂接事件。
   * 失败时必须自行回滚已创建的资源；状态由基类的 connect/reconnect 复位。
   * @param reconnect 是否复用上一次的端点（自动重连）
   */
  protected abstract openTransport(reconnect: boolean): Promise<void>;

  /** 写出原始 XML 帧 */
  protected abstract writeRaw(xml: string): void;

  /** 发送传输层的流开启标签（TCP: `<stream:stream>`；WS: `<open/>`） */
  protected abstract sendStreamOpen(): void;

  /** 发送传输层的流关闭标签（TCP: `</stream:stream>`；WS: `<close/>`） */
  protected abstract sendStreamClose(): void;

  /** 关闭底层传输（TCP socket / WebSocket）；会话状态由 {@link onTransportClosed} 清理 */
  protected abstract closeTransport(): void;

  /** 处理收到的原始数据：解析分帧后交给 {@link handleStanza} */
  protected abstract feed(data: string): void;

  // ---------------------------------------------------------------------------
  // 公共生命周期
  // ---------------------------------------------------------------------------

  /** 连接；端点已在创建传输实例时确定 */
  async connect(): Promise<void> {
    return this.begin(Status.CONNECTING, false);
  }

  /** 复用同一实例（保留管线与会话状态）重新建立底层连接 */
  async reconnect(): Promise<void> {
    return this.begin(Status.RECONNECTING, true);
  }

  /**
   * 建连统一入口：同步占位状态后委托子类建立底层传输，失败时复位。
   * @param status 本次连接的状态（CONNECTING / RECONNECTING）
   * @param reuse 是否复用上一次的端点
   */
  private async begin(
    status: (typeof Status)[keyof typeof Status],
    reuse: boolean,
  ): Promise<void> {
    // 防重复连接：入口即检查并同步占位，并发调用在此快速失败
    if (this.status !== Status.DISCONNECTED) {
      throw new Error("连接已在进行中，请先 disconnect() 再重连");
    }
    this.status = status;
    try {
      await this.openTransport(reuse);
    } catch (error) {
      this.status = Status.DISCONNECTED;
      throw error;
    }
  }

  /** 关闭 XMPP 流并断开底层连接 */
  disconnect(): void {
    // 幂等守卫：未连接或已断开时直接返回，避免重复关闭事件
    if (
      this.status === Status.DISCONNECTED ||
      this.status === Status.SESSIONEND
    ) {
      return;
    }
    this.stopNegotiationTimer();
    try {
      this.sendStreamClose();
    } catch (error) {
      log.warn("发送流关闭标签失败，可能是连接已断开", error);
    }
    log.info("关闭XMPP流");
    this.status = Status.SESSIONEND;
    this.closeTransport();
  }

  /** 发送数据到底层传输；字符串直接发送，元素先序列化 */
  send(data: string | XMPPElement): void {
    this.writeRaw(typeof data === "string" ? data : data.toXMLString());
  }

  // ---------------------------------------------------------------------------
  // 流协商（与传输无关）
  // ---------------------------------------------------------------------------

  /** 底层传输就绪：发送流开启标签并进入协商起点 */
  protected openStream(): void {
    this.status = Status.CONNECTED;
    this.sendStreamOpen();
    this.status = Status.STREAM_START;
    // 进入流协商：开始等待首个 features
    this.startNegotiationTimer();
  }

  /** 分发入口：协商阶段 stanza 走对应管线事件，其余（业务 stanza）投递到 stanza 事件 */
  private async route(stanza: XMPPElement): Promise<void> {
    // 只看「有没有数据传来」：协商阶段任意入站节都重置看门狗
    this.refreshNegotiationTimer();
    // 每个阶段构造各自的最小载荷：处理器共享同一引用，决策类事件写回 outgoing
    switch (this.status) {
      // 首次流特性：STARTTLS 决策（具体处理器由支持该协商的传输注册）
      case Status.STREAM_START:
        await this.pipeline.run("stream:features:starttls", { stanza });
        return;
      // STARTTLS 协商：<proceed/> 由处理器校验
      case Status.STARTTLS:
        await this.pipeline.run("starttls:proceed", { stanza });
        return;
      // TLS 已建立（STARTTLS 升级 / 直连 TLS）后的流特性：直接 SASL 决策
      case Status.TLS_ESTABLISHED:
        await this.pipeline.run("stream:features:mechanisms", { stanza });
        return;
      // 认证中：challenge / success / failure 均走同一认证事件，由 onSasl 统一处理
      case Status.AUTHENTICATING:
        await this.pipeline.run("sasl", { stanza });
        return;
      // 认证后再次收到 features：解析能力并触发资源绑定
      case Status.AUTHENTICATED:
        await this.pipeline.run("stream:negotiated", { stanza });
        return;
      // 绑定/恢复请求的响应：交由 binding 事件管线处理
      case Status.BINDING: {
        // 初始值仅满足类型；defineProperty 后 status 读写的是连接实例状态
        const ctx: BindingContext = { stanza, status: this.status };
        Object.defineProperty(ctx, "status", {
          get: () => this.status,
          set: (value: (typeof Status)[keyof typeof Status]) => {
            this.status = value;
          },
          enumerable: true,
        });
        await this.pipeline.run("binding", ctx);
        return;
      }
      // 其余状态（含 BINDED 后的业务 stanza）：投递到 stanza 通知
      default:
        this.sink.onStanza(stanza);
    }
  }

  /** 协商与业务 stanza 的统一入口：解析流错误后按状态分发 */
  protected async handleStanza(stanza: XMPPElement): Promise<void> {
    try {
      if (isStreamError(stanza)) {
        // 流错误的条件与 <text/> 都是 <stream:error> 的直接子元素（RFC 6120 §4.9.1）
        const condition =
          stanza.firstElementChild?.localName ?? "undefined-condition";
        const text = stanza.querySelector(":scope > text")?.textContent;
        // 服务端关闭流多为重启/迁移，按网络断开处理并允许重连
        throw new ProtocolError({
          scope: "stream",
          message: `流错误: ${condition}`,
          condition,
          text,
          retryable:condition === "system-shutdown",
        });
      }
      // 协商与业务 stanza 统一由 route 分发
      await this.route(stanza);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /** 协商失败统一处理：归一化错误、标记状态、上报并断开 */
  protected handleFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    const protocolError = this.toProtocolError(failure);
    // 按归一化后的 scope 标记状态，避免依赖消息文案或具体错误类
    this.status =
      protocolError.scope === "sasl" ? Status.AUTHFAIL : Status.ERROR;
    this.sink.onError(protocolError);
    this.disconnect();
  }

  /**
   * 把协商/协议错误归一化为 {@link ProtocolError}。
   * `handleStanza` 构造的流错误原样返回。
   */
  private toProtocolError(error: Error): ProtocolError {
    if (error instanceof ProtocolError) return error;
    // 认证失败或认证阶段的错误归为 sasl，绑定阶段归为 binding
    const scope =
      this.status === Status.AUTHENTICATING
        ? "sasl"
        : this.status === Status.BINDING
          ? "binding"
          : "protocol";
    return new ProtocolError({
      scope,
      message: error.message,
      condition: error instanceof XMPPError ? error.condition : undefined,
      text: error instanceof XMPPError ? error.text : undefined,
      cause: error,
    });
  }

  /** 从流特性宣告选择 SASL 机制并生成初始认证请求 */
  protected startSasl(features: XMPPElement): string {
    const mechanisms = Array.from(
      features.getElementsByTagName("mechanism"),
      (element) => element.textContent,
    );
    return this.sasl.start(mechanisms, this.password);
  }

  /** 核心处理器：stream:features:mechanisms —— TLS 已建立（升级或直连），开始 SASL 认证 */
  protected async onFeaturesMechanisms(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    if (!isStreamFeatures(ctx.stanza)) {
      return next();
    }
    this.status = Status.STREAM_ESTABLISHED;
    ctx.outgoing = this.startSasl(ctx.stanza);
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
    this.status = Status.AUTHENTICATING;
  }

  /** 核心处理器：sasl —— 统一处理认证事件（challenge 应答 / success 完成 / failure 转协议错误） */
  protected async onSasl(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // 非 SASL 节不参与认证，放行给其他处理器
    const event = parseSaslEvent(ctx.stanza);
    if (!event) return next();
    const result = await this.sasl.process(event, this.password);
    if (result.type === "send") {
      ctx.outgoing = result.data;
    } else if (result.type === "success") {
      this.status = Status.AUTHENTICATED;
      // 流重启（RFC 6120 §6.4.5）：服务器会重新发送 features，随后进入绑定
      this.sendStreamOpen();
    } else {
      // 认证失败：统一包装为可被上层按 scope 判断的协议错误
      throw new ProtocolError({
        scope: "sasl",
        message: `认证失败: ${result.condition}`,
        condition: result.condition,
      });
    }
    await next();
    // 放行后续处理器，若有 ctx.outgoing 则发送
    if (ctx.outgoing) this.send(ctx.outgoing);
  }

  /** 核心处理器：stream:negotiated —— 收集能力，并预填资源绑定请求（插件可整体替换以改发） */
  protected async onNegotiated(
    ctx: SendContext & { outgoing?: string },
    next: () => Promise<void>,
  ): Promise<void> {
    // 判断是否为流特性 stanza（RFC 6120 §4.3.2）
    if (!isStreamFeatures(ctx.stanza)) {
      return next();
    }
    const features = collectStreamFeatures(ctx.stanza);
    this.streamFeatures = features;
    // 预填绑定请求：插件可在管线中整体替换 outgoing 改发（如 XEP-0198 的 <resume/>）
    if (ctx.stanza.getElementsByTagNameNS(BIND_NS, "bind").length > 0) {
      const request = buildBindRequest(this.jid.resource);
      // 记录请求 id，供 onBinding 匹配响应；插件替换 outgoing 时该 id 仍用于恢复失败回退
      this.bindId = request.id;
      ctx.outgoing = request.data;
    }
    await next();
    if (!ctx.outgoing) return;
    // 插件改发的请求：响应按 stanza 透传给插件，超时由插件自管
    this.status = Status.BINDING;
    this.send(ctx.outgoing);
  }

  /** 核心处理器：binding —— 匹配绑定响应并直接处理结果；其余响应（插件改发的请求）放行给插件 */
  protected async onBinding(
    ctx: SendContext,
    next: () => Promise<void>,
  ): Promise<void> {
    const { stanza } = ctx;
    const iqType = stanza.getAttribute("type");
    // 仅当 IQ id 与绑定请求一致时才视为绑定结果，避免误吞插件改发请求的响应
    const isBindResponse =
      stanza.tagName === "iq" &&
      (iqType === "result" || iqType === "error") &&
      stanza.getAttribute("id") === this.bindId;
    if (isBindResponse) {
      // 绑定结果：成功解析绑定 JID，iq error 由 parseBindResult 抛错
      this.jid = parseBindResult(stanza, this.jid.bare);
      this.status = Status.BINDED;
    }
    // 非绑定响应（如插件改发 <resume/> 的回复）：先放行给插件处理
    await next();
    if (this.status === Status.BINDED) {
      // 协商完成：停止看门狗，后续业务数据不再计时
      this.stopNegotiationTimer();
      this.sink.onBinded();
    }
    // XEP0198 需要：会话恢复被拒时写回原绑定请求，由连接层代发
    if (ctx.outgoing) this.send(ctx.outgoing);
    // 无人消费的非绑定响应广播到 stanza 通知，避免静默丢弃
    if (!isBindResponse) this.sink.onStanza(stanza);
  }

  // ---------------------------------------------------------------------------
  // 收尾与工具
  // ---------------------------------------------------------------------------

  /**
   * 底层传输关闭后的统一收尾：发出连接关闭通知并清理会话残留。
   * 子类在 socket/WebSocket 的关闭回调中调用。
   * @param closeEvent WebSocket 关闭事件（TCP 无此参数）
   */
  protected onTransportClosed(closeEvent?: CloseEvent): void {
    this.stopNegotiationTimer();
    this.status = Status.DISCONNECTED;
    this.bindId = undefined;
    this.streamFeatures.clear();
    this.sasl.reset();
    this.sink.onClose(closeEvent);
  }

  /** 清除连接超时定时器 */
  protected clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  /**
   * 启动流协商看门狗（进入协商时调用）。
   * 只看「一段时间内有没有数据传来」，不判断该节属于哪个阶段。
   */
  private startNegotiationTimer(): void {
    this.negotiationTimer = setTimeout(() => {
      this.status = Status.TIMEOUT;
      log.error("流协商超时: 30 秒内未收到服务器数据");
      this.sink.onError(
        new ProtocolError({
          scope: "stream",
          message: "协商超时: 30 秒内未收到服务器数据",
          retryable: true,
        }),
      );
      this.disconnect();
    }, NEGOTIATION_TIMEOUT);
    this.negotiationTimer?.unref?.();
  }

  /** 协商阶段收到数据时重置；已停止（绑定完成/断开）后不再启动 */
  private refreshNegotiationTimer(): void {
    if (!this.negotiationTimer) return;
    clearTimeout(this.negotiationTimer);
    this.startNegotiationTimer();
  }

  /** 停止流协商看门狗（绑定完成或连接关闭） */
  private stopNegotiationTimer(): void {
    clearTimeout(this.negotiationTimer);
    this.negotiationTimer = undefined;
  }
}
