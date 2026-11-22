import { StreamManagement } from "./streamManagement";
import type { Plugin } from "../types";
import type Connection from "@/connection";
import { StanzaBase } from "@/stanza";
import { XMPPError } from "@/errors";
import { Status } from "@/transport/typing";
import type { BindingContext, SendContext } from "@/transport/stream-connection";
import logger from "@/log";
import { escapeXML } from "@/ltx";
import type { XMPPElement } from "@/ltx/Element";
const log = logger.getLogger("XEP0198");

const StreamStatus = {
    /**未启用 */
    DISABLE: 0,
    /**已向服务器发送启用（enable）请求，正等待确认 */
    ENABLE_SENT: 1,
    /**已启用流管理 */
    ENABLE: 2,
} as const;

/**
 * XEP-0198 Stream Management
 * @see https://xmpp.org/extensions/xep-0198.html
 * @version 1.6.3 (2025-07-28)
 */
export default class XEP0198 extends StreamManagement implements Plugin {

    /** XMPP连接实例 */
    private readonly connection: Connection;
    /** 已发送的 stanza 数量，按 uint32 回绕；恒等于 `lastAck + unacked.length`（模 2^32） */
    private outbound: number = 0;
    /** 已处理的 stanza 数量，即应答确认请求时的 h 值；按 uint32 回绕 */
    private inbound: number = 0;
    /** 请求确认的消息间隔数 */
    static readonly interval = 5;
    /** h 为 xs:unsignedInt，取值 0..2^32-1，越过 2^32-1 回到 0；计数模数即 2^32（XEP-0198 §4） */
    private static readonly COUNTER_MODULO = 4_294_967_296;
    /** 流管理状态 */
    private status: typeof StreamStatus[keyof typeof StreamStatus] = StreamStatus.DISABLE;
    /** 会话恢复ID */
    private previd: string = "";
    /** 服务器在 <enabled/> 中给出的下次重连端点（XEP-0198 §3），仅生效一次 */
    private reconnectEndpoint?: { host: string; port?: string };
    /** 服务器是否允许会话恢复（<enabled resume='true'/>） */
    private resumable = false;
    /** 服务器宣告的最大会话恢复时间（ms），取自 <enabled max='...'/>（协议单位为秒）；未宣告时默认 5 分钟 */
    private max = 5 * 60 * 1000;
    /** 断开时刻（ms），用于判定恢复是否已超出服务器保留窗口 */
    private disconnectedAt = 0;
    /** 被<resume/>顶替的原始绑定请求，恢复失败时由 applyResumeResponse 写回 outgoing */
    private bindRequest?: XMPPElement | string;
    /** 服务端已确认的最后一条出站 stanza 序号，按 uint32 回绕（XEP-0198 §4） */
    private lastAck = 0;
    /**
     * 未确认队列：已发出但未获服务端确认的 stanza，按发送顺序排列。
     * 第 i 项对应的发送序号为 `lastAck + i + 1`（模 2^32），长度恒等于 `outbound - lastAck`（模 2^32）。
     * 持有的是调用方的元素引用；发送后不得再修改该元素，否则重发内容会随之变化。
     */
    private unacked: XMPPElement[] = [];

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        log.debug('初始化 XEP-0198 Stream Management 插件');
        // 流管理属流层：协商管线取传输层；启用时机跟随高层会话就绪事件
        const transport = this.connection.transport;
        if (!transport) {
            log.warn('传输层未提供连接管线，流管理无法协商');
        } else {
            // 认证后特性 → 抢占为恢复；绑定响应 → 处理恢复结果
            transport.pipeline
                .use("stream:negotiated", this.resumeSession.bind(this))
                .use("binding", this.applyResumeResponse.bind(this));
        }
        // 会话就绪后启用：首连走 session:start，自动重连（含恢复失败后的全量重绑定）走 reconnected
        const onSessionReady = () =>
            void this.enable().catch((error: unknown) => log.error('启用流管理失败', error));
        this.connection.on("session:start", onSessionReady);
        this.connection.on("reconnected", onSessionReady);
        // 主动关闭流前报告已处理数量（XEP-0198 §4）：此刻会话与发送管线仍可用，需同步写出
        this.connection.on("session:beforeclose", () => {
            if (this.status === StreamStatus.ENABLE) this.sendAnswerAck();
        });
        // 断线 → 可恢复时只记录时刻供恢复判定；不可恢复时旧流的计数与状态一并作废，新流需重新 <enable/>
        // 服务器建议的端点只用于下一次连接（XEP-0198 §3），写入后立即清空
        this.connection.on("connection:lost", () => {
            const endpoint = this.reconnectEndpoint;
            this.reconnectEndpoint = undefined;
            if (this.resumable && this.previd) {
                this.disconnectedAt = Date.now();
            } else {
                log.debug("本次会话无法恢复，旧流状态已复位，新流将重新启用流管理");
                this.reset();
            }
            const target = this.connection.transport;
            if (!endpoint || !target) return;
            target.host = endpoint.host;
            if (endpoint.port) target.port = endpoint.port;
            log.debug(`下次连接使用服务器位置: ${endpoint.host}:${target.port}`);
        });
        this.registerTracking();
    }

    /** 注册计数与确认处理器；由 init 调用一次，是否生效由流管理状态决定 */
    private registerTracking() {
        this.connection.pipeline.use("send", (ctx, next) => {
            // 先写出：写出失败会抛错中断整条链，此时本条 stanza 并未发出，不应计数
            next();
            // 以最终写出形态计数，下游中间件可能改写 stanza
            const stanza = ctx.stanza;
            if (this.status >= StreamStatus.ENABLE_SENT && ["iq", "message", "presence"].includes(stanza.tagName)) {
                this.outbound = (this.outbound + 1) % XEP0198.COUNTER_MODULO;
                this.unacked.push(stanza);
                log.debug(`当前发送数量：${this.outbound}`);
                // 延后到管线退出后再请求确认，避免在 send 管线栈内重入发送 <r/>；
                // 判断必须同步执行，否则同批发送的微任务会看到同一个序号
                if (this.outbound % XEP0198.interval === 0) {
                    void Promise.resolve().then(() => this.requestAck());
                }
            }
        });

        this.connection.pipeline.use("receive", (ctx, next) => {
            const stanza = ctx.stanza;
            if (this.status >= StreamStatus.ENABLE && ["iq", "message", "presence"].includes(stanza.tagName)) {
                this.inbound = (this.inbound + 1) % XEP0198.COUNTER_MODULO;
            }
            return next();
        });

        this.connection.on("others", (stanza) => {
            // 流管理启用前不处理确认元素
            if (this.status < StreamStatus.ENABLE || stanza.xml.namespaceURI !== XEP0198.NS) return;
            if (stanza.tagName === "r") {
                log.debug("收到确认请求");
                this.sendAnswerAck();
            } else if (stanza.tagName === "a") {
                // <a/> 是累积确认，任一条都表示 h 之前的出站节已处理（XEP-0198 §4）
                this.advanceAck(stanza.xml.getAttribute("h")!);
            }
        });
    }

    /** 尝试恢复会话 */
    private resumeSession(ctx: SendContext, next: () => Promise<void>) {
        // 恢复条件：本次为意外断线后的重连（connection:lost 记录）且此前已启用流管理、持有恢复ID、服务器允许恢复
        if (!this.disconnectedAt || this.status !== StreamStatus.ENABLE || !this.previd || !this.resumable) {
            return next();
        }
        // 距断开已超过服务器保留窗口，恢复必然失败（XEP-0198 §4），reset 后改走全量绑定
        if (Date.now() - this.disconnectedAt > this.max) {
            log.warn(`距断开已超过 ${this.max}ms，放弃恢复会话，改为常规绑定`);
            this.reset();
            return next();
        }
        log.info(`尝试恢复会话，previd: ${this.previd}, h: ${this.inbound}`);
        // 暂存原始绑定请求，恢复被拒后回退
        this.bindRequest = ctx.outgoing;
        // 直接替换为恢复请求，响应由 applyResumeResponse 处理器接收
        // SM-ID 是服务端生成的不透明值，合法取值可含 & 与引号（XEP-0198 §5），作为属性值必须转义
        ctx.outgoing = `<resume xmlns='${XEP0198.NS}' h='${this.inbound}' previd='${escapeXML(this.previd)}'/>`;
        return next();
    }

    /** 阶段：绑定/恢复请求的响应（binding）。收到 <resumed/> 则沿用原绑定并置为已绑定，收到 <failed/> 则回退为常规绑定请求重发 */
    private applyResumeResponse(ctx: BindingContext, next: () => Promise<void>) {
        // 未启用流管理或没有恢复ID：是首次连接的绑定响应，放行
        if (this.status !== StreamStatus.ENABLE || !this.previd) return next();
        const stanza = ctx.stanza;
        if (stanza.namespaceURI !== XEP0198.NS) return next();
        if (stanza.tagName === "resumed") {
            // XEP-0198 §5：resumed 必须回带请求中的 SM-ID，不一致说明恢复的不是这条流
            if (stanza.getAttribute("previd") !== this.previd) {
                // 与 <failed/> 一致：旧流终结，未确认项不会在新流重发
                const pending = this.unacked.length;
                log.warn(pending > 0
                    ? `服务器返回的恢复 ID 与请求不一致，改为常规绑定；${pending} 条未确认的 stanza 不会重发`
                    : '服务器返回的恢复 ID 与请求不一致，改为常规绑定');
                ctx.outgoing = this.bindRequest;
                this.reset();
                return next();
            }
            // 规范要求 <resumed/> 必须带 h（XEP-0198 §5），与 <a/> 同样按确认游标处理
            if (!this.advanceAck(stanza.getAttribute("h")!)) {
                // h 超过已发送数量：已按 §6 关流，不把本次恢复当作成功
                return next();
            }
            log.info('会话恢复成功');
            ctx.status = Status.BINDED;
            this.resendUnacked();
        } else if (stanza.tagName === "failed") {
            // XEP-0198 §5：服务器认出 previd 但会话已超时时可带 h，值为超时前收到的条数，按确认游标结算
            const handled = stanza.getAttribute("h");
            if (handled !== null && !this.advanceAck(handled)) return next();
            // 旧流已终结：未确认的 stanza 不能在新流重发（资源与 presence 均已重建），按 §4 应由应用决定后续
            const pending = this.unacked.length;
            log.warn(pending > 0
                ? `服务器拒绝恢复会话，改为常规绑定；${pending} 条未确认的 stanza 不会重发`
                : '服务器拒绝恢复会话，改为常规绑定');
            // 回退为原始绑定请求，由连接层发送；reset 会清掉 bindRequest
            ctx.outgoing = this.bindRequest;
            this.reset();
        }
        return next();
    }

    /**
     * 恢复成功后按序重发仍未确认的 stanza（XEP-0198 §5）。
     *
     * 直接交给传输层写出，绕过发送管线：这些 stanza 已占用原序号，不能再计数或入队，
     * 重发内容也必须与首次写出保持一致，不能被其他插件的发送拦截器改写。
     *
     * 队列中的 presence 同样重发：§5 的「SHOULD NOT resend presence」限定于
     * 「重播在线状态以恢复旧状态」（服务器已保留该状态），而未确认队列属于同节
     * 「MUST re-send any stanzas that are still marked as unhandled」；跳过这一条
     * 会让服务端计数与本地队列永久错位，后续确认将删错队列项。
     */
    private resendUnacked() {
        if (this.unacked.length === 0) return;
        const transport = this.connection.transport;
        if (!transport) {
            log.warn(`无法重发 ${this.unacked.length} 条未确认的 stanza：传输层不可用`);
            return;
        }
        log.info(`会话恢复，重发 ${this.unacked.length} 条未确认的 stanza`);
        for (const stanza of this.unacked) {
            try {
                transport.send(stanza);
            } catch (error) {
                // 写出失败说明连接再次中断，剩余项随下次断线交给恢复流程处理
                log.error(() => `重发未确认 stanza 失败: ${String(error)}`);
                return;
            }
        }
    }

    /**
     * 阶段：会话就绪（session:start / reconnected）。服务器宣告流管理时发出 <enable/> 启用，并等待服务器的响应
     * @throws 服务器返回 <failed/> 时抛 XMPPError；等待期间断线（<enabled/> 未到）时抛 Error
     */
    private async enable(): Promise<void> {
        // 会话恢复成功同样触发binded，此时流管理已处于启用状态
        if (this.status !== StreamStatus.DISABLE) return;
        if (!this.connection.transport?.streamFeatures.has(XEP0198.NS)) {
            log.info('服务器不支持流管理');
            return;
        }
        log.info('正在启用流管理...');
        return new Promise<void>((resolve, reject) => {
            const onResponse = (response: StanzaBase) => {
                if (response.xml.namespaceURI !== XEP0198.NS) return;
                const xml = response.xml;
                if (response.tagName === "failed") {
                    cleanup();
                    this.reset();
                    reject(new XMPPError(xml, "服务器拒绝启用流管理"));
                    return;
                }
                if (response.tagName !== "enabled") return;
                cleanup();
                // XEP-0198 §3：仅当服务器显式允许（resume='true'）才可在断线后恢复
                this.resumable =
                    xml.getAttribute("resume") === "true" || xml.getAttribute("resume") === "1";
                // 接收计数（h）自收到 <enabled/> 起开窗（XEP-0198 §4）
                this.inbound = 0;
                this.status = StreamStatus.ENABLE;
                log.info(`启用流管理成功`);
                // 不支持恢复时 id/max/location 都无意义，直接结束
                if (!this.resumable) {
                    log.info("服务器不支持会话恢复，断线后将走全量绑定");
                    resolve();
                    return;
                }
                this.previd = xml.getAttribute("id") ?? "";
                const max = Number.parseInt(xml.getAttribute("max") ?? "300"); // 默认 5 分钟
                if (Number.isSafeInteger(max)) {
                    // 服务端发来的是秒
                    this.max = max * 1000;
                    log.debug(`设置最大恢复时间: ${this.max}ms`);
                }

                const location = xml.getAttribute("location");
                if (location) {
                    this.reconnectEndpoint = XEP0198.parseLocation(location);
                    if (this.reconnectEndpoint) {
                        log.debug(`服务器建议的重连位置: ${location}`);
                    }
                }
                resolve();
            };

            // 未确认的 <enable/> 随本流作废：断线时摘掉本次监听并复位，由下次会话就绪后重发
            const onLost = () => {
                cleanup();
                this.status = StreamStatus.DISABLE;
                // 启用结果已不可知，必须结束等待，否则调用方永久挂起
                reject(new Error("连接中断，流管理启用未确认"));
            };
            const cleanup = () => {
                this.connection.off("others", onResponse);
                this.connection.off("connection:lost", onLost);
            };

            // 先监听后发送，避免漏掉立即返回的响应
            this.connection.on("others", onResponse);
            this.connection.on("connection:lost", onLost);
            // 只有发送计数自写出 <enable/> 起开窗（XEP-0198 §4）；接收计数在收到 <enabled/> 时才开窗
            this.outbound = 0;
            this.lastAck = 0;
            this.unacked.length = 0;
            this.status = StreamStatus.ENABLE_SENT;
            try {
                this.connection.send(`<enable xmlns='${XEP0198.NS}' resume='true'/>`);
            } catch (error) {
                cleanup();
                this.reset();
                reject(error instanceof Error ? error : new Error(String(error)));
            }

        });
    }


    /** 复位流管理状态 */
    private reset() {
        this.status = StreamStatus.DISABLE;
        this.previd = "";
        this.reconnectEndpoint = undefined;
        this.resumable = false;
        this.max = 5 * 60 * 1000;
        this.disconnectedAt = 0;
        this.inbound = 0;
        this.outbound = 0;
        this.lastAck = 0;
        this.unacked.length = 0;
        this.bindRequest = undefined;
    }

    /**
     * 解析 location 值：host[:port]（IPv6 用方括号），不是完整 URL（XEP-0198 §3 / RFC 6120 §4.9.3.19）
     * @param location 服务器给出的重连地址，省略端口时沿用当前端口
     * @returns 解析后的端点；格式非法时为 undefined
     */
    private static parseLocation(location: string): { host: string; port?: string } | undefined {
        try {
            const url = new URL(`xmpp://${location}`);
            if (!url.hostname) return undefined;
            // URL.hostname 会保留 IPv6 的方括号，连接前去掉
            return { host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || undefined };
        } catch (error: unknown) {
            log.warn(`无法解析服务器返回的重连位置: ${location}`, error);
            return undefined;
        }
    }

    /**
     * 按服务端确认的 h 推进确认游标并裁剪未确认队列。
     *
     * `<a/>` 与 `<resumed/>` 的 h 语义相同：该序号之前的出站节都已处理（XEP-0198 §4、§5）。
     * 确认允许重复、滞后与部分到达，游标只会前进。
     * @param raw h 属性值；规范保证这两个元素必带 h（XEP-0198 §4、§5），按 xs:unsignedInt 读取
     * @returns 可以继续处理时为 true；h 超过已发送数量时已按 §6 关闭流并返回 false
     */
    private advanceAck(raw: string): boolean {
        const h = Number.parseInt(raw);
        if (!Number.isInteger(h) || h >= XEP0198.COUNTER_MODULO) {
            log.warn(`忽略无法解析的确认数量: ${raw}`);
            return true;
        }
        // 本次确认相对游标推进的条数：先加模数再取余，避免 h 回绕小于游标时得到负数
        const delta = (h - this.lastAck + XEP0198.COUNTER_MODULO) % XEP0198.COUNTER_MODULO;
        // 重复确认：h 与当前游标相同
        if (delta === 0) return true;
        // 序号到 2^32 就归零，因此旧确认算出来是个巨大的数：
        // 已确认 10 条时收到 12 表示前进 2 条；收到 8 会算得 4294967294 条，是乱序迟到的旧确认，
        // 超过半个范围（2^31）就判定为迟到并丢弃
        if (delta >= XEP0198.COUNTER_MODULO / 2) {
            log.debug(`忽略迟到的确认: ${h}，当前游标: ${this.lastAck}`);
            return true;
        }
        if (delta > this.unacked.length) {
            this.failAck(h);
            return false;
        }
        this.lastAck = h;
        this.unacked.splice(0, delta);
        log.debug(`确认进度更新: ${this.lastAck}，未确认 ${this.unacked.length} 条`);
        return true;
    }

    /**
     * 确认数量超过已发送数量时终止流（XEP-0198 §6）：发送 `undefined-condition` 流错误并关闭。
     * 直接写传输层，避免流错误被发送管线当作业务 stanza 加工；随后 `disconnect()` 写出 `</stream:stream>`。
     * @param h 对端上报的确认数量
     */
    private failAck(h: number) {
        const transport = this.connection.transport;
        if (!transport) return;
        log.error(`对端确认数量 ${h} 超过已发送数量 ${this.outbound}，关闭流`);
        const xml =
            `<stream:error xmlns:stream='http://etherx.jabber.org/streams'>` +
            `<undefined-condition xmlns='urn:ietf:params:xml:ns:xmpp-streams'/>` +
            `<handled-count-too-high xmlns='${XEP0198.NS}' h='${h}' send-count='${this.outbound}'/>` +
            `</stream:error>`;
        try {
            transport.send(xml);
        } catch (error) {
            log.error(() => `发送流错误失败: ${String(error)}`);
        }
        // 先复位：beforeclose 监听器据此不再补发 <a/>，§6 流错误之后不应再有流管理元素
        this.reset();
        this.connection.disconnect();
    }

    /**
     * 发送<a/>标签确认已处理的消息数量
     */
    private sendAnswerAck() {
        log.debug(`发送确认应答，当前处理消息数: ${this.inbound}`);
        this.connection.send(`<a xmlns='${XEP0198.NS}' h='${this.inbound}'/>`);
    }

    /**
     * 发送 `<r/>` 请求服务器确认。
     *
     * 响应不需要与本次请求关联：任何 `<a/>` 都携带当前累积确认进度，由常驻处理器推进游标。
     */
    private requestAck() {
        if (this.status < StreamStatus.ENABLE) return;
        log.debug(`请求服务器确认，当前发送消息数: ${this.outbound}`);
        try {
            this.connection.send(`<r xmlns='${XEP0198.NS}'/>`);
        } catch (error) {
            log.error(() => `请求确认失败: ${String(error)}`);
        }
    }
}
