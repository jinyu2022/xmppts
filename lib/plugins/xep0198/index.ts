import { StreamManagement } from "./streamManagement";
import type { Plugin } from "../types";
import type Connection from "@/connection";
import { StanzaBase } from "@/stanza";
import { TimeoutError, XMPPError } from "@/errors";
import { Status } from "@/transport/typing";
import type { BindingContext, SendContext } from "@/transport/tcp";
import logger from "@/log";
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
    readonly connection: Connection;
    /** 发送的stanza数量，也是服务端接收处理的stanza数量 */
    private outbound: number = 0;
    /** 已处理的stanza数量，即应答确认请求时的h值 */
    private inbound: number = 0;
    /** 请求确认的消息间隔数 */ 
    static readonly interval = 5;
    /** 流管理状态 */
    private status: typeof StreamStatus[keyof typeof StreamStatus] = StreamStatus.DISABLE;
    /** 会话恢复ID */
    private previd: string = "";
    /** 服务器建议的重连位置 */
    private location?: string;
    /** 服务器是否允许会话恢复（<enabled resume='true'/>） */
    private resumable = false;
    /** 服务器宣告的最大会话恢复时间（ms），取自 <enabled max='...'/>（协议单位为秒）；未宣告时默认 5 分钟 */
    private max = 5 * 60 * 1000;
    /** 断开时刻（ms），用于判定恢复是否已超出服务器保留窗口 */
    private disconnectedAt = 0;
    /** 恢复响应超时定时器 */
    private resumeTimer?: ReturnType<typeof setTimeout>;
    /** 被<resume/>顶替的原始绑定请求，恢复失败时由 applyResumeResponse 写回 outgoing */
    private bindRequest?: XMPPElement | string;
    /** 计数与确认处理器是否已注册 */
    private tracking = false;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    /** 传输层 socket（带管线与恢复出口，见 {@link PipelineSocket}） */
    // private get socket(): PipelineSocket | null {
    //     return this.connection.socket as PipelineSocket | null;
    // }

    init() {
        log.debug('初始化 XEP-0198 Stream Management 插件');
        // 流管理属流层：管线与就绪信号统一取传输层，不与会话层事件混用
        const transport = this.connection.transport;
        if (!transport) {
            log.warn('传输层未提供连接管线，流管理无法协商');
        } else {
            // 认证后特性 → 抢占为恢复；绑定响应 → 处理恢复结果
            transport.pipeline
                .use("stream:negotiated", this.resumeSession.bind(this))
                .use("binding", this.applyResumeResponse.bind(this));
            // binded 是唯一覆盖首连/自动重连/恢复回退三条路径的就绪信号
            transport.on("binded", () =>
                void this.enable().catch((error: unknown) => log.error('启用流管理失败', error)),
            );
        }
        // 断线 → 记录时刻，供恢复时判定是否超出服务器保留窗口
        this.connection.on("connection:lost", () => {
            this.disconnectedAt = Date.now();
        });
    }

    /** 启用成功后注册计数与确认处理器，重复启用时只注册一次 */
    private registerTracking() {
        if (this.tracking) return;
        this.tracking = true;
        this.connection.pipeline.use("send", (ctx, next) => {
            const stanza = ctx.stanza;
            if (this.status >= StreamStatus.ENABLE_SENT && ["iq", "message", "presence"].includes(stanza.tagName)) {
                this.outbound++;
                log.debug(`当前发送数量：${this.outbound}`);
                // 延后到本条stanza写出后再请求确认，避免<r/>先于计数对象发出
                void Promise.resolve().then(() => this.requestAckAndCheck());
            }
            return next();
        });

        this.connection.pipeline.use("receive", (ctx, next) => {
            const stanza = ctx.stanza;
            if (this.status >= StreamStatus.ENABLE && ["iq", "message", "presence"].includes(stanza.tagName)) {
                this.inbound++;
            }
            return next();
        });

        this.connection.on("others", (stanza) => {
            if (stanza.tagName === "r" && stanza.xml.namespaceURI === XEP0198.NS) {
                log.debug("收到确认请求");
                this.sendAnswerAck();
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
        ctx.outgoing = `<resume xmlns='${XEP0198.NS}' h='${this.inbound}' previd='${this.previd}'/>`;
        // this.resumeTimer = setTimeout(() => {
        //     this.resumeTimer = undefined;
        //     log.error('恢复会话超时，改为常规绑定');
        //     this.reset();
        //     this.startBind();
        // }, 30_000);
        return next();
    }

    /** 阶段：绑定/恢复请求的响应（binding）。收到 <resumed/> 则沿用原绑定并置为已绑定，收到 <failed/> 则回退为常规绑定请求重发 */
    private applyResumeResponse(ctx: BindingContext, next: () => Promise<void>) {
        // 未启用流管理或没有恢复ID：是首次连接的绑定响应，放行
        if (this.status !== StreamStatus.ENABLE || !this.previd) return next();
        const stanza = ctx.stanza;
        if (stanza.namespaceURI !== XEP0198.NS) return next();
        if (this.resumeTimer) clearTimeout(this.resumeTimer);
        this.resumeTimer = undefined;
        if (stanza.tagName === "resumed") {
            const h = Number.parseInt(stanza.getAttribute("h") ?? "0");
            if (h !== this.outbound) {
                log.warn(
                    `服务器汇报的已处理数量与本地不一致，local:${this.outbound}, server:${h}`
                );
                this.outbound = h;
                //TODO: 重新发送未确认的消息
            }
            log.info('会话恢复成功');
            ctx.status = Status.BINDED;
            // connection上面和socket有关的东西都要重新绑定，对象换了 
        } else if (stanza.tagName === "failed") {
            log.warn('服务器拒绝恢复会话，改为常规绑定');
            // 回退为原始绑定请求，由连接层发送
            ctx.outgoing = this.bindRequest;
            this.reset();
            this.bindRequest = undefined;
        }
        return next();
    }

    /**
     * 阶段：资源绑定完成（binded）。服务器宣告流管理时发出 <enable/> 启用，并等待服务器的响应
     * @returns 服务器的<enabled/>响应；已启用或服务器未宣告时无返回值
     */
    private async enable(): Promise<XMPPElement | undefined> {
        // 会话恢复成功同样触发binded，此时流管理已处于启用状态
        if (this.status !== StreamStatus.DISABLE) return;
        if (!this.connection.transport?.streamFeatures.has(XEP0198.NS)) {
            log.info('服务器不支持流管理');
            return;
        }
        log.info('正在启用流管理...');
        return new Promise<XMPPElement>((resolve, reject) => {
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
                    resolve(xml);
                    return;
                }
                this.previd = xml.getAttribute("id") ?? "";
                const max = xml.getAttribute("max");
                if (max) {
                    // 服务端发来的是秒
                    this.max = Number.parseInt(max) * 1000;
                    log.debug(`设置最大恢复时间: ${this.max}ms`);
                }

                const location = xml.getAttribute("location");
                if (location) {
                    this.location = location;
                    try {
                        // XEP-0198 §3 / RFC 6120 §4.9.3.19：location 为 host[:port]（IPv6 用方括号），不是完整 URL，补一个协议前缀以便解析
                        const url = new URL(`xmpp://${location}`);
                        if (url.hostname) {
                            // URL.hostname 会保留 IPv6 的方括号，连接前去掉
                            this.connection.transport!.host = url.hostname.replace(/^\[|\]$/g, "");
                        }
                        if (url.port) this.connection.transport!.port = url.port;
                    } catch (error: unknown) {
                        log.warn(`无法解析服务器返回的重连位置: ${location}`, error);
                    }
                    log.debug(`服务器位置: ${this.location}`);
                }
                resolve(xml);
            };

            // 未确认的 <enable/> 随本流作废：断线时摘掉本次监听并复位，由下次 binded 重发
            const onLost = () => {
                cleanup();
                this.status = StreamStatus.DISABLE;
                this.outbound = 0;
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
            this.status = StreamStatus.ENABLE_SENT;
            this.registerTracking();
            this.connection.send(`<enable xmlns='${XEP0198.NS}' resume='true'/>`);

        });
    }


    /** 复位流管理状态 */
    private reset() {
        this.status = StreamStatus.DISABLE;
        this.previd = "";
        this.location = undefined;
        this.resumable = false;
        this.max = 5 * 60 * 1000;
        this.disconnectedAt = 0;
        this.outbound = 0;
        this.inbound = 0;
        this.bindRequest = undefined;
    }

    /**
     * 发送数量达到interval整数倍时请求确认并核对服务器进度
     */
    private requestAckAndCheck() {
        if (this.status < StreamStatus.ENABLE) return;
        if (this.outbound === 0 || this.outbound % XEP0198.interval !== 0) return;
        this.requestAck()
            .then((h) => {
                if (h !== this.outbound) {
                    log.warn(
                        `服务器汇报的已处理数量与本地不一致，local:${this.outbound}, server:${h}`
                    );
                } else {
                    log.info("请求确认成功");
                }
            })
            .catch((error: unknown) => {
                log.error(() => `请求确认失败: ${String(error)}`);
            });
    }

    /**
     * 发送<a/>标签确认已处理的消息数量
     */
    private sendAnswerAck() {
        log.debug(`发送确认应答，当前处理消息数: ${this.inbound}`);
        this.connection.send(`<a xmlns='${XEP0198.NS}' h='${this.inbound}'/>`);
    }

    /**
     * 手动请求确认：发送 `<r/>` 并等待服务器回 `<a/>`
     *
     * @returns 服务器已处理的 stanza 数量（`<a/>` 的 h 值）
     * @throws {TimeoutError} 30 秒内未收到 `<a/>`
     */
    private requestAck(): Promise<number> {
        log.debug(`请求服务器确认，当前发送消息数: ${this.outbound}`);
        return new Promise<number>((resolve, reject) => {
            const onResponse = (response: StanzaBase) => {
                if (
                    response.tagName !== "a" ||
                    response.xml.namespaceURI !== XEP0198.NS
                ) return;
                cleanup();
                log.debug("收到确认", () => response.toString());
                resolve(Number.parseInt(response.xml.getAttribute("h") ?? "0"));
            };

            const timer = setTimeout(() => {
                cleanup();
                log.error('请求确认超时');
                reject(new TimeoutError("请求确认超时"));
            }, 30_000);
            timer.unref?.();
            const cleanup = () => {
                this.connection.off("others", onResponse);
                clearTimeout(timer);
            };

            // 先监听后发送，避免漏掉立即返回的响应
            this.connection.on("others", onResponse);
            this.connection.send(`<r xmlns='${XEP0198.NS}'/>`);
        });
    }
}
