import type Connection from "@/connection";
import { XMPPError } from "@/errors";
import { JID } from "@/JID";
import { Message } from "@/stanza";
import logger from "@/log";
import { Form, type DataForm } from "../xep0004/form";
import type { Plugin } from "../types";
import {
    Mam,
    type MamFin,
    type MamMetadata,
    type MamPage,
    type MamQueryOptions,
    type MamResult,
} from "./mam";

const log = logger.getLogger("XEP0313");

/** 生成器按到达顺序交付的事件：归档结果、收尾的 fin 或失败原因 */
type Delivery =
    | { type: "result"; item: MamResult }
    | { type: "fin"; fin: MamFin }
    | { type: "error"; error: unknown };

/**
 * XEP-0313: Message Archive Management
 *
 * 查询账户或 MUC 房间的消息归档。结果由服务器以普通 message 逐条推送，
 * 收尾的 `<fin/>` 通过查询 IQ 返回。
 * @see https://xmpp.org/extensions/xep-0313.html
 * @version 1.1.3 (2025-04-09)
 */
export class XEP0313 extends Mam implements Plugin {
    static readonly dependencies = ["XEP0004", "XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        // MAM 没有服务端主动推送，结果只在本插件的查询期间到达，不注册 stanza 转换器
        this.connection.XEP0030!.addFeature(Mam.NS);
    }

    /**
     * 查询归档，返回完整一页
     *
     * @param archive 归档地址：账户归档传自身 bare JID，MUC 归档传房间 bare JID
     * @param options 查询条件
     * @param onResult 每收到一条结果立即回调；抛出的异常只记录，不中断查询
     * @throws 服务器返回错误节时抛 XMPPError；超时抛 name 为 `TimeoutError` 的 DOMException
     */
    async queryArchive(
        archive: string | JID,
        options: MamQueryOptions = {},
        onResult?: (item: MamResult) => void,
    ): Promise<MamPage> {
        // for await 会丢掉生成器的返回值，手写 next 循环才能取回 fin
        const iterator = this.runQuery(new JID(archive.toString()), options);
        const results: MamResult[] = [];
        while (true) {
            const { value, done } = await iterator.next();
            if (done) return { results, fin: value };
            if (onResult) {
                try {
                    onResult(value);
                } catch (error) {
                    // 单条结果的本地处理失败不应中断整页查询
                    log.warn(`归档结果回调失败：${value.id}`, error);
                }
            }
            results.push(value);
        }
    }

    /**
     * 查询归档，按服务器推送顺序逐条产出结果
     *
     * 查询在首次 `next()` 时发出，拿到迭代器后应立即消费。中途 `break` 后不再
     * 产出新结果，但服务器会继续推送到 fin，监听器到那时才摘除。
     * @param archive 归档地址：账户归档传自身 bare JID，MUC 归档传房间 bare JID
     * @param options 查询条件
     * @returns 异步迭代器；fin 到达后结束，查询失败时抛出原因
     */
    iterateArchive(
        archive: string | JID,
        options: MamQueryOptions = {},
    ): AsyncIterableIterator<MamResult> {
        // 生成器的返回值（fin）对 `for await` 不可见，不对外暴露
        return this.runQuery(new JID(archive.toString()), options);
    }

    /**
     * 查询归档元数据（§5），需服务端声明 {@link Mam.NS_EXTENDED}
     * @param archive 归档地址，缺省为自身 bare JID
     * @throws 服务器返回错误节时抛 XMPPError
     */
    async queryMetadata(archive?: string | JID): Promise<MamMetadata> {
        const resIq = await this.connection.sendAsync(
            Mam.createMetadataIq(archive),
        );
        if (resIq.getAttribute("type") === "error") {
            throw new XMPPError(resIq, "查询归档元数据失败");
        }
        return Mam.parseMetadataEl(resIq).metadata;
    }

    /**
     * 查询服务器支持的查询字段（§4.1.5）
     * @param archive 归档地址，缺省为自身 bare JID
     * @throws 服务器返回错误节时抛 XMPPError
     */
    async queryFormFields(archive?: string | JID): Promise<DataForm> {
        const resIq = await this.connection.sendAsync(
            Mam.createFormFieldsIq(archive),
        );
        if (resIq.getAttribute("type") === "error") {
            throw new XMPPError(resIq, "查询归档表单字段失败");
        }
        const form = resIq.querySelector(
            `:scope > query[xmlns="${Mam.NS}"] > x[xmlns="${Form.NS}"]`,
        );
        if (!form) throw new Error(`响应中没有数据表单: ${resIq.toXMLString()}`);
        return Form.parseFormEl(form).form;
    }

    /**
     * 查询归档的结果流：边收边产出，收到 fin 后结束
     *
     * 结果、fin 与错误都作为事件进入同一个队列：结果由服务器逐条推送，fin 与
     * 错误随查询 IQ 的响应到达。消费者中途 `break` 时生成器的 finally 摘除监听器。
     * @param archive 归档地址
     * @param options 查询参数
     * @returns 逐条产出结果的生成器，正常结束时返回 fin
     */
    private async *runQuery(
        archive: JID,
        options: MamQueryOptions,
    ): AsyncGenerator<MamResult, MamFin> {
        const queryid = crypto.randomUUID();
        // 队列与等待者构成一个单消费者的事件通道
        const inbox: Delivery[] = [];
        let waiting: ((event: Delivery) => void) | undefined;
        /** 投递事件：有等待者直接交出，否则排队 */
        const push = (event: Delivery) => {
            if (waiting) {
                const resolve = waiting;
                waiting = undefined;
                resolve(event);
            } else {
                inbox.push(event);
            }
        };
        /** 取下一条事件，队列空时等待投递 */
        const next = (): Promise<Delivery> => {
            const event = inbox.shift();
            if (event) return Promise.resolve(event);
            return new Promise((resolve) => {
                waiting = resolve;
            });
        };
        // 监听器必须先于查询发出：结果推送可能早于 sendAsync 的 await 恢复
        const listener = (message: Message) => {
            // 归档结果只在本查询期间到达；stanza 内不使用前缀，按 xmlns 定位即可。
            // queryid 一并放进选择器：并发查询各自持有监听器，非本查询的结果在此直接跳过，
            // 不必先解析 forwarded/delay/message
            const resultEl = message.xml.querySelector(
                `:scope > result[xmlns="${Mam.NS}"][queryid="${queryid}"]`,
            );
            if (!resultEl) return;
            // §9.2：结果来源必须与查询的归档地址一致，否则可能是伪造
            if (message.from.bare !== archive.bare) {
                log.warn(
                    `忽略来源不符的归档结果：from=${message.from.toString()}，期望=${archive.bare}`,
                );
                return;
            }
            const result = Mam.parseResultEl(resultEl).result;
            if (!result.message) {
                log.warn(`归档结果缺少 forwarded/message：${result.id}`);
                return;
            }
            push({
                type: "result",
                item: {
                    id: result.id,
                    stamp: result.stamp,
                    message: new Message(result.message, this.connection),
                },
            });
        };
        this.connection.on("message", listener);
        try {
            await this.checkQueryCapabilities(archive, options);
            // fin 与结果到得一样晚，同样作为事件投递；结果已经先一步入队
            void this.connection
                .sendAsync(Mam.createQueryIq(archive, options, queryid))
                .then((resIq) => {
                    if (resIq.getAttribute("type") === "error") {
                        throw new XMPPError(resIq, "查询消息归档失败");
                    }
                    push({ type: "fin", fin: Mam.parseFinEl(resIq).fin });
                })
                .catch((error: unknown) => {
                    push({ type: "error", error });
                });
            while (true) {
                const event = await next();
                if (event.type === "result") {
                    yield event.item;
                } else if (event.type === "fin") {
                    return event.fin;
                } else {
                    throw event.error instanceof Error
                        ? event.error
                        : new Error("查询消息归档失败", {
                              cause: event.error,
                          });
                }
            }
        } finally {
            this.connection.off("message", listener);
        }
    }

    /**
     * 使用扩展字段前校验服务端能力
     *
     * §4.1.3 与 §4.2.3 要求客户端确认服务端声明 `#extended`，§4.1.4 要求确认
     * `#groupchat-field`；基础查询不产生额外请求。
     * @param archive 归档地址
     * @param options 查询参数
     * @throws 服务端未声明对应特性时抛 Error
     */
    private async checkQueryCapabilities(
        archive: JID,
        options: MamQueryOptions,
    ) {
        const needsExtended =
            options.beforeId !== undefined ||
            options.afterId !== undefined ||
            (options.ids?.length ?? 0) > 0 ||
            options.flip === true;
        const needsGroupchatField = options.includeGroupchat !== undefined;
        if (!needsExtended && !needsGroupchatField) return;
        const { features } = await this.connection.XEP0030!.getDiscoInfo(
            archive.bare,
        );
        if (needsExtended && !features.has(Mam.NS_EXTENDED)) {
            throw new Error(
                `${archive.bare} 未声明 ${Mam.NS_EXTENDED}，不能使用 beforeId/afterId/ids/flip`,
            );
        }
        if (needsGroupchatField && !features.has(Mam.NS_GROUPCHAT_FIELD)) {
            throw new Error(
                `${archive.bare} 未声明 ${Mam.NS_GROUPCHAT_FIELD}，不能使用 includeGroupchat`,
            );
        }
    }
}

export default XEP0313;
