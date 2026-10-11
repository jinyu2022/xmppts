import type { Plugin } from "@/plugins/types";
import type Connection from "@/connection";
import type { Iq } from "@/stanza";
import { XMPPError } from "@/errors";
import Ping from "./ping";
import logger from "@/log";
const log = logger.getLogger("XEP0199");

/**
 * XEP-0199 插件配置，全部可选，省略时取 {@link XEP0199.config} 的默认值
 */
interface XEP0199Options {
    /** 是否启用keepalive功能，默认启用。 */
    keepalive?: boolean;
    /** keepalive的ping间隔，单位毫秒，默认5分钟。 */
    interval?: number;
    /** ping请求的默认超时时间，单位毫秒，默认30秒。 */
    timeout?: number;
}

/**
 * XEP-0199：XMPP Ping
 * @see https://xmpp.org/extensions/xep-0199.html
 * @version 2.0.1 (2019-03-26)
 */
export default class XEP0199 extends Ping implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;
    private timer?: ReturnType<typeof setInterval>;
    private readonly config = {
        /** 是否启用keepalive功能，默认启用。 */
        keepalive: true,
        /** keepalive的ping间隔，单位毫秒，默认5分钟。 */
        interval: 300_000,
        /** ping请求的默认超时时间，单位毫秒，默认30秒。 */
        timeout: 30_000,
    };

    constructor(connection: Connection, options?: XEP0199Options) {
        super();
        this.connection = connection;
        if (options) {
            const { keepalive, interval, timeout } = options;
            if ((interval ?? this.config.interval) < (timeout ?? this.config.timeout)) {
                log.warn(`interval 短于 timeout，改用默认值`);
                this.config.keepalive = keepalive ?? this.config.keepalive;
            }else {
                this.config={...this.config, ...options};
            }
        }
    }

    init() {
        const respondToPingIq = (iq: Iq) => {
            if (
                iq.type === "get" &&
                Array.from(iq.xml.querySelectorAll(":scope > ping")).some(
                    (el) => el.namespaceURI === Ping.NS
                )
            ) {
                const result = Ping.createPingResultIq(this.connection.jid, iq.from.toString(), iq.id!);
                this.connection.send(result);
            }
        };
        this.connection.on("iq", respondToPingIq);

        this.connection.XEP0030!.addFeature(Ping.NS);
        // 会话建立后才查询服务器特性；未就绪时 getter 直接拒绝，不会发出请求
        this.connection.once("session:start", () => {
            void this.connection
                .XEP0030!.getServerFeatures()
                .then((features) => {
                    if (!features.has(Ping.NS)) return log.info("服务器不支持XEP-0199");
                    if (this.config.keepalive) this.keepAlivePing();
                })
                .catch((error: unknown) => log.warn("获取服务器特性失败", error));
        });
    }

    /**
     * 向指定的 XMPP 实体发送 ping 请求，并记录请求的耗时。
     *
     * @param to - 目标 XMPP 实体的 JID（Jabber Identifier）。
     * @param timeout - 可选的超时时间（毫秒），默认值为取自 config。
     * @returns ping耗时
     * @throws 当 ping 请求返回错误时抛出异常。包括超时和错误响应
     */
    async ping(to: string, timeout = this.config.timeout): Promise<number> {
        const pingIq = Ping.createSendPingIq(to);
        const startTime = Date.now();
        // 失败（含超时）由调用方按需记录，此处不重复输出
        const res = await this.connection.sendAsync(pingIq, timeout);

        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "ping 失败");
        }

        const endTime = Date.now(); // End timing
        const duration = endTime - startTime; // Calculate duration
        log.debug(`Ping to ${to} took ${duration} ms`);
        return duration;
    }

    /**
     * 立即启动或重排 keepalive ping 的定时器。若已存在定时器，则先清除旧的。
     * 该方法会在实例化时自动调用一次，通常不需要手动调用。
     */
    keepAlivePing() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            void (async () => {
                // 会话未就绪（未连接、协商中或自动重连中）不发 ping，避免无谓超时
                if (!this.connection.isSessionActive) {
                    return;
                }
                if (this.config.keepalive) {
                    try {
                        await this.ping(this.connection.jid.domain, this.config.timeout);
                    } catch (error) {
                        log.warn("KeepAlive ping 失败", error);
                    }
                }
            })();
        }, this.config.interval);
        this.timer?.unref?.();
    }
}
