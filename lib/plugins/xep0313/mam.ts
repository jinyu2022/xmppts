import { XMPPElement } from "@/ltx/Element";
import { Iq, StanzaBase, type Message } from "@/stanza";
import type { JID } from "@/JID";
import { Form, type Field } from "../xep0004/form";
import { RSM, type RsmRequest, type RsmResult } from "../xep0059/rsm";
import { XMPPDateTime } from "../xep0082/dateTime";

/** MAM 查询参数（XEP-0313 §4），只含规范定义的表单字段与分页参数 */
export interface MamQueryOptions {
    /** 只返回与该 JID 收发的消息（§4.1.1） */
    with?: string | JID;
    /** 起始时间，含（§4.1.2） */
    start?: Date;
    /** 截止时间，含（§4.1.2） */
    end?: Date;
    /** 只返回该 UID 之前的消息，需服务端声明 `#extended`（§4.1.3） */
    beforeId?: string;
    /** 只返回该 UID 之后的消息，需服务端声明 `#extended`（§4.1.3） */
    afterId?: string;
    /** 只返回这些 UID 的消息，需服务端声明 `#extended`（§4.1.3） */
    ids?: string[];
    /** 是否包含 groupchat 消息，需服务端声明 `#groupchat-field`（§4.1.4） */
    includeGroupchat?: boolean;
    /** 分页参数（§4.2） */
    page?: RsmRequest;
    /** 请求服务器倒序推送页内结果，需服务端声明 `#extended`（§4.2.3） */
    flip?: boolean;
}

/** 归档中的一条消息 */
export interface MamResult {
    /** 归档 UID（`<result/>` 的 id），按不透明字符串对待 */
    id: string;
    /** 消息入库时间，取自 forwarded 内的 `<delay/>`；服务端未提供时缺省 */
    stamp?: Date;
    /** 被归档的原始消息 */
    message: Message;// 类型可以更加详细准确
}

/** 查询收尾的 `<fin/>`（§4） */
export interface MamFin {
    /** 结果集是否已完整返回，属性缺省为 false */
    complete: boolean;
    /** 结果是否稳定，属性缺省视为 true */
    stable: boolean;
    /** 分页信息 */
    rsm?: RsmResult;
}

/** 归档元数据（§5） */
export interface MamMetadata {
    /** 最早一条消息；空归档时缺省 */
    start?: { id: string; timestamp: Date };
    /** 最新一条消息；空归档时缺省 */
    end?: { id: string; timestamp: Date };
}

/** 一页查询结果 */
export interface MamPage {
    /** 按服务器推送顺序（时间序）排列的结果 */
    results: MamResult[];
    /** 收尾的 `<fin/>` */
    fin: MamFin;
}

/**
 * XEP-0313: Message Archive Management
 *
 * 纯工具类：构造查询节、解析结果、`<fin/>` 与归档元数据；查询流程由插件
 * {@link XEP0313} 负责。
 * @see https://xmpp.org/extensions/xep-0313.html
 * @version 1.1.3 (2025-04-09)
 */
export class Mam {
    static readonly NS = "urn:xmpp:mam:2";
    /** 扩展查询字段与归档元数据的能力标识（§7） */
    static readonly NS_EXTENDED = "urn:xmpp:mam:2#extended";
    /** `include-groupchat` 字段的能力标识（§7） */
    static readonly NS_GROUPCHAT_FIELD = "urn:xmpp:mam:2#groupchat-field";

    /**
     * 构造查询 IQ（§4）
     * @param archive 归档地址，作为 IQ 的接收方
     * @param options 查询参数
     * @param queryid 本次查询的标识，服务器在每条结果上回显
     * @returns `iq type="set"`，载荷为 `<query/>`、数据表单与可选的 `<set/>`
     */
    static createQueryIq(
        archive: string | JID,
        options: MamQueryOptions,
        queryid: string,
    ): XMPPElement {
        const iq = Iq.createIq("set", archive);
        const query = XMPPElement.createElementNS(Mam.NS, "query", { queryid });
        const fields: Field[] = [
            { type: "hidden", var: "FORM_TYPE", values: [Mam.NS] },
        ];
        if (options.with !== undefined) {
            fields.push({
                type: "jid-single",
                var: "with",
                values: [options.with.toString()],
            });
        }
        if (options.start) {
            fields.push({
                type: "text-single",
                var: "start",
                values: [XMPPDateTime.formatDateTime(options.start)],
            });
        }
        if (options.end) {
            fields.push({
                type: "text-single",
                var: "end",
                values: [XMPPDateTime.formatDateTime(options.end)],
            });
        }
        if (options.beforeId !== undefined) {
            fields.push({
                type: "text-single",
                var: "before-id",
                values: [options.beforeId],
            });
        }
        if (options.afterId !== undefined) {
            fields.push({
                type: "text-single",
                var: "after-id",
                values: [options.afterId],
            });
        }
        if (options.ids?.length) {
            fields.push({ type: "list-multi", var: "ids", values: options.ids });
        }
        if (options.includeGroupchat !== undefined) {
            fields.push({
                type: "boolean",
                var: "include-groupchat",
                values: [String(options.includeGroupchat)],
            });
        }
        query.appendChild(Form.createFormEl({ type: "submit", fields }));
        if (options.page) query.appendChild(RSM.createSetEl(options.page));
        // §4.2.3：倒序推送页内结果，不影响返回哪些结果
        if (options.flip) {
            query.appendChild(XMPPElement.createElementNS(Mam.NS, "flip-page"));
        }
        iq.appendChild(query);
        return iq;
    }

    /**
     * 解析归档结果 `<result/>`（§4）
     *
     * 结果只在查询期间到达，由插件直接传入 `message.xml`，不经 stanza 转换器。
     * @param el `<result/>` 元素，或包含它的 stanza
     * @throws 未找到 `<result/>` 时抛出 Error
     */
    static parseResultEl(el: XMPPElement) {
        const result =
            el.getAttribute("xmlns") === Mam.NS
                ? el
                : el.querySelector(`:scope > result[xmlns="${Mam.NS}"]`);
        if (!result) throw new Error(`未找到 result 元素: ${el.toXMLString()}`);
        const forwarded = result.querySelector(
            ':scope > forwarded[xmlns="urn:xmpp:forward:0"]',
        );
        // delay 是 SHOULD（§4），缺失时不给 stamp
        const stamp = forwarded
            ?.querySelector(':scope > delay[xmlns="urn:xmpp:delay"]')
            ?.getAttribute("stamp");
        return {
            result: {
                // §4：结果必须带 id 属性
                id: result.getAttribute("id")!,
                queryid: result.getAttribute("queryid") ?? undefined,
                // §4：forwarded 内是被归档的原始 message
                message:
                    forwarded?.querySelector(
                        `:scope > message[xmlns="${StanzaBase.NS}"]`,
                    ) ?? undefined,
                stamp: stamp ? XMPPDateTime.parseDateTime(stamp) : undefined,
            },
        };
    }

    /**
     * 解析收尾的 `<fin/>`（§4.2.2）
     * @param el `<fin/>` 元素，或该 IQ 响应
     * @throws 未找到 `<fin/>` 时抛出 Error
     */
    static parseFinEl(el: XMPPElement): Record<"fin", MamFin> {
        const fin =
            el.getAttribute("xmlns") === Mam.NS
                ? el
                : el.querySelector(`:scope > fin[xmlns="${Mam.NS}"]`);
        if (!fin) throw new Error(`未找到 fin 元素: ${el.toXMLString()}`);
        const set = fin.querySelector(`:scope > set[xmlns="${RSM.NS}"]`);
        return {
            fin: {
                complete: Mam.readBoolAttribute(fin, "complete") ?? false,
                stable: Mam.readBoolAttribute(fin, "stable") ?? true,
                rsm: set ? RSM.parseSetEl(set).rsm : undefined,
            },
        };
    }

    /**
     * 解析归档元数据（§5），需服务端声明 {@link Mam.NS_EXTENDED}
     * @param el `<metadata/>` 元素，或该 IQ 响应
     * @throws 未找到 `<metadata/>` 时抛出 Error
     */
    static parseMetadataEl(el: XMPPElement): Record<"metadata", MamMetadata> {
        const metadata =
            el.getAttribute("xmlns") === Mam.NS
                ? el
                : el.querySelector(`:scope > metadata[xmlns="${Mam.NS}"]`);
        if (!metadata)
            throw new Error(`未找到 metadata 元素: ${el.toXMLString()}`);
        // start/end 与 metadata 同属 MAM 命名空间，靠继承，按标签名取
        const startEl = metadata.querySelector(":scope > start");
        const endEl = metadata.querySelector(":scope > end");
        return {
            metadata: {
                start: startEl ? Mam.parseArchiveEdge(startEl) : undefined,
                end: endEl ? Mam.parseArchiveEdge(endEl) : undefined,
            },
        };
    }

    /**
     * 构造归档元数据查询 IQ（§5）
     * @param archive 归档地址，缺省由服务器按发送者归属处理
     */
    static createMetadataIq(archive?: string | JID): XMPPElement {
        const iq = Iq.createIq("get", archive);
        iq.appendChild(XMPPElement.createElementNS(Mam.NS, "metadata"));
        return iq;
    }

    /**
     * 构造查询表单字段的 IQ（§4.1.5）
     * @param archive 归档地址，缺省由服务器按发送者归属处理
     */
    static createFormFieldsIq(archive?: string | JID): XMPPElement {
        const iq = Iq.createIq("get", archive);
        iq.appendChild(XMPPElement.createElementNS(Mam.NS, "query"));
        return iq;
    }

    /** 解析元数据里表示归档首尾消息的 `<start/>` 或 `<end/>` */
    static parseArchiveEdge(el: XMPPElement): { id: string; timestamp: Date } {
        return {
            // §5：非空归档的 start/end 必然带 id 与 timestamp
            id: el.getAttribute("id")!,
            timestamp: XMPPDateTime.parseDateTime(
                el.getAttribute("timestamp")!,
            ),
        };
    }

    /**
     * 读取 XML Schema 的 boolean 属性
     * @param el 元素
     * @param name 属性名
     * @returns 属性缺失时为 undefined
     */
    private static readBoolAttribute(
        el: XMPPElement,
        name: string,
    ): boolean | undefined {
        const value = el.getAttribute(name);
        if (value === null) return undefined;
        return value === "true" || value === "1";
    }
}
