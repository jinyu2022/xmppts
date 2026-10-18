import { EventEmitter } from "events";
import { EntityCaps, type Capabilities } from "@/plugins/xep0115/entityCaps";
import { XMPPElement } from "@/ltx";
import { JID } from "@/JID";
import { TimeoutError } from "@/errors";
import { generateSecureNonce } from "@/auth/scram";
import { SaslClient, SaslError, SASL_NS, type SaslEvent } from "@/auth/sasl";
import { firstCondition } from "@/util/xml";
import logger from "@/log";
import { Status, type TransportSocket } from "./typing";
import { Pipeline } from "./pipeline";

const log = logger.getLogger("stream");

/** 资源绑定命名空间 (RFC 6120 §7) */
export const BIND_NS = "urn:ietf:params:xml:ns:xmpp-bind";
// NOSONAR: RFC 6120 固定的 XML 命名空间标识符，不是网络请求地址。
export const STREAM_NS = "http://etherx.jabber.org/streams";
/** 流错误条件命名空间 (RFC 6120 §4.9.1) */
const STREAM_ERROR_NS = "urn:ietf:params:xml:ns:xmpp-streams";

/** 流特性宣告解析结果 */
interface StreamFeatures {
    /** 服务器支持的所有命名空间集合 */
    namespaces: Set<string>;
    /** 可选的实体能力 (XEP-0115) */
    entityCaps?: Capabilities;
}

/** 资源绑定请求，包含唯一 ID 和 XML 序列化数据 */
interface BindRequest {
    id: string;
    data: string;
}

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

/** 从流特性宣告中收集所有命名空间及可选的实体能力 (XEP-0115)。 */
export function collectStreamFeatures(
    features: XMPPElement,
): StreamFeatures {
    const namespaces = new Set<string>();
    let entityCaps: Capabilities | undefined;

    for (const feature of features.childNodes) {
        if (!(feature instanceof XMPPElement) || !feature.namespaceURI) continue;
        // 收集所有功能命名空间
        namespaces.add(feature.namespaceURI);
        // 如果是实体能力声明 (XEP-0115)，解析出能力信息
        if (feature.namespaceURI === EntityCaps.NS) {
            entityCaps = EntityCaps.parseCaps(feature).cap;
        }
    }

    return { namespaces, entityCaps };
}

/**
 * 从流错误 stanza 中提取错误条件名称。
 * 优先匹配 STREAM_ERROR_NS 命名空间下的子元素，
 * 回退接受无命名空间或空命名空间的元素以兼容部分实现。
 */
export function getStreamErrorCondition(stanza: XMPPElement): string {
    return firstCondition(stanza, "undefined-condition", STREAM_ERROR_NS);
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
        case "failure":
            // 规范要求 failure 至少包含一个条件；缺失时按 not-authorized 处理（RFC 6120 §6.5.2）
            return {
                type: "failure",
                condition: firstCondition(stanza, "not-authorized"),
            };
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
export function buildBindRequest(resource?: string): BindRequest {
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
    // 服务器返回错误：提取错误条件（RFC 6120 §8.3.2）
    if (type === "error") {
        const error = response.getElementsByTagName("error")[0];
        throw new Error(
            `资源绑定失败: ${error ? firstCondition(error, "unknown") : "unknown"}`,
        );
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
    "stream:negotiated": SendContext & { outgoing?: string; };
    /** 绑定/恢复请求的响应：处理器可处理自己改发的请求，并可写回 `outgoing` 发送下一条请求，`status` 为连接状态访问器 */
    binding: BindingContext;
};

/** 传输层统一事件：TCP 与 WebSocket 共用 */
export interface SocketEventMap {
    /** 传输连接就绪并已发出流开启标签，进入协商起点 */
    open: void;
    /** 底层连接关闭；WS 携带关闭事件，TCP 为 undefined */
    close: CloseEvent | undefined;
    /** 协商或传输错误 */
    error: Error;
    /** SASL 认证成功 */
    authenticated: void;
    /** XMPP 流开启（含认证后的流重启） */
    "stream:start": void;
    /** XMPP 流结束（本端或对端发出流尾） */
    "stream:end": void;
    /** 协商完成后的业务 stanza */
    stanza: XMPPElement;
    /** 资源绑定完成（含 XEP-0198 会话恢复成功） */
    binded: void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface StreamConnection {
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
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class StreamConnection
    extends EventEmitter
    implements TransportSocket {
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
    /** 服务器宣告的实体能力（XEP-0115），未宣告则为 undefined */
    entityCaps?: Capabilities;
    /** 连接管线：全部连接/协商/断开阶段在此流转 */
    readonly pipeline = new Pipeline<TransportPipelineEvents>();
    /** TCP 与 WebSocket 共用的 SASL 客户端 */
    protected readonly sasl: SaslClient;
    /** 资源绑定请求 id，用于匹配响应 */
    private bindId?: string;
    /** 资源绑定超时定时器 */
    private bindTimer?: ReturnType<typeof setTimeout>;
    /** 连接建立超时定时器（由子类在拨号时设置） */
    protected connectTimer?: ReturnType<typeof setTimeout>;

    protected constructor(jid: JID, password: string) {
        super();
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
        try {
            this.sendStreamClose();
        } catch (error) {
            log.warn("发送流关闭标签失败，可能是连接已断开", error);
        }
        log.info("关闭XMPP流");
        this.status = Status.SESSIONEND;
        this.emit("stream:end");
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
        this.emit("stream:start");
        this.status = Status.STREAM_START;
        this.emit("open");
    }

    /** 分发入口：协商阶段 stanza 走对应管线事件，其余（业务 stanza）投递到 stanza 事件 */
    private async route(stanza: XMPPElement): Promise<void> {
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
            // 其余状态（含 BINDED 后的业务 stanza）：投递到 stanza 事件
            default:
                this.emit("stanza", stanza);
        }
    }

    /** 协商与业务 stanza 的统一入口：解析流错误后按状态分发 */
    protected async handleStanza(stanza: XMPPElement): Promise<void> {
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
    protected handleFailure(error: unknown): void {
        const failure = error instanceof Error ? error : new Error(String(error));
        // 以错误类别（SaslError）而非消息文案判断认证失败，避免文案变更破坏逻辑
        this.status = failure instanceof SaslError ? Status.AUTHFAIL : Status.ERROR;
        this.emit("error", failure);
        this.disconnect();
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

    /** 核心处理器：sasl —— 统一处理认证事件（challenge 应答 / success 完成，failure 抛出 SaslError） */
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
            this.emit("authenticated");
            // 流重启（RFC 6120 §6.4.5）：服务器会重新发送 features，随后进入绑定
            this.sendStreamOpen();
            this.emit("stream:start");
        }
        await next();
        // 放行后续处理器，若有 ctx.outgoing 则发送
        if (ctx.outgoing) this.send(ctx.outgoing);
    }

    /** 核心处理器：stream:negotiated —— 收集能力，并预填资源绑定请求（插件可整体替换以改发） */
    protected async onNegotiated(
        ctx: SendContext & { outgoing?: string; },
        next: () => Promise<void>,
    ): Promise<void> {
        // 判断是否为流特性 stanza（RFC 6120 §4.3.2）
        if (!isStreamFeatures(ctx.stanza)) {
            return next();
        }
        const features = collectStreamFeatures(ctx.stanza);
        this.streamFeatures = features.namespaces;
        this.entityCaps = features.entityCaps;
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
            this.clearBindTimer();
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
        const request = buildBindRequest(this.jid.resource);
        this.bindId = request.id;
        this.status = Status.BINDING;
        this.send(request.data);
        // 与 sendAsync 的默认 IQ 超时保持一致（30s）
        this.bindTimer = setTimeout(() => {
            this.bindTimer = undefined;
            this.bindId = undefined;
            this.status = Status.ERROR;
            this.emit("error", new TimeoutError(`请求超时: ${request.id}`));
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

    // ---------------------------------------------------------------------------
    // 收尾与工具
    // ---------------------------------------------------------------------------

    /**
     * 底层传输关闭后的统一收尾：发出流结束/连接关闭事件并清理会话残留。
     * 子类在 socket/WebSocket 的关闭回调中调用。
     * @param closeEvent WebSocket 关闭事件（TCP 无此参数）
     */
    protected onTransportClosed(closeEvent?: CloseEvent): void {
        if (this.status !== Status.SESSIONEND) {
            this.status = Status.SESSIONEND;
            this.emit("stream:end");
        }
        this.status = Status.DISCONNECTED;
        this.clearBindTimer();
        this.streamFeatures.clear();
        this.entityCaps = undefined;
        this.sasl.reset();
        this.emit("close", closeEvent);
    }

    /** 清除连接超时定时器 */
    protected clearConnectTimer(): void {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
    }

    /** 清除资源绑定定时器与待匹配 id */
    protected clearBindTimer(): void {
        if (this.bindTimer) clearTimeout(this.bindTimer);
        this.bindTimer = undefined;
        this.bindId = undefined;
    }
}
