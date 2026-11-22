import { XMPPElement } from "@/ltx/Element";
import logger from "@/log";
import { XEP0426 } from "../xep0426";

const log = logger.getLogger("XEP0372");

/** `<reference/>` 的解析结果 */
export interface MessageReference {
    /** 引用类型，如 `mention`、`data` */
    type: string;
    /** 被引用对象的 URI */
    uri: string;
    /** 引用文本起始位置（Unicode 码点，含）；带 `anchor` 时指原消息正文中的位置 */
    begin?: number;
    /** 引用文本结束位置（Unicode 码点，不含）；带 `anchor` 时指原消息正文中的位置 */
    end?: number;
    /** 指向包含该引用的原消息（referring message）的 URI，用于标注历史消息（§3.4） */
    anchor?: string;
}

/**
 * XEP-0372: References
 *
 * 在消息正文中标记 @提及、数据引用等区间；`begin`/`end` 按 Unicode 码点计。
 * @see https://xmpp.org/extensions/xep-0372.html
 * @version 0.5.0 (2020-12-09)
 */
export class Reference {
    static readonly NS = "urn:xmpp:reference:0" as const;

    /**
     * 解析 `urn:xmpp:reference:0` 命名空间下的单个 `<reference/>`
     *
     * 一条消息可携带多个引用，框架会对每个元素各调用一次，
     * 并把每次返回的数组拼接到同一个字段。
     * @param referenceEl 待解析的元素
     * @returns 只含当前引用的数组；缺少必需属性时不产生 `references` 字段
     */
    static parseReferenceEl(
        referenceEl: XMPPElement,
    ): { references?: MessageReference[] } {
        if (referenceEl.namespaceURI !== Reference.NS) {
            throw new Error(`不是一个 reference 元素: ${referenceEl.toXMLString()}`);
        }

        const type = referenceEl.getAttribute("type");
        const uri = referenceEl.getAttribute("uri");
        if (!type || !uri) {
            log.warn(`忽略缺少 type/uri 的引用: ${referenceEl.toXMLString()}`);
            return {};
        }

        const reference: MessageReference = { type, uri };
        const begin = Reference.parseOffset(referenceEl.getAttribute("begin"));
        const end = Reference.parseOffset(referenceEl.getAttribute("end"));
        if (begin !== undefined) reference.begin = begin;
        if (end !== undefined) reference.end = end;
        const anchor = referenceEl.getAttribute("anchor");
        if (anchor) reference.anchor = anchor;
        return { references: [reference] };
    }

    /** 解析十进制非负整数偏移；缺失或非法时返回 undefined */
    private static parseOffset(value: string | null): number | undefined {
        // 规范要求是正文索引，只接受纯数字，避免 Number() 接受 1e3、0x10 等写法
        if (!value || !/^\d+$/u.test(value)) return undefined;
        const offset = Number(value);
        return Number.isSafeInteger(offset) ? offset : undefined;
    }

    /**
     * 创建 `<reference/>`
     * @param reference 引用内容
     * @throws `type`/`uri` 为空，偏移不是非负整数，`begin` 大于 `end`，或 `begin`/`end` 只给了一个时抛错
     */
    static createReferenceEl(reference: MessageReference) {
        if (!reference.type || !reference.uri) {
            throw new Error("reference 必须包含 type 与 uri");
        }
        Reference.assertOffset("begin", reference.begin);
        Reference.assertOffset("end", reference.end);
        if (
            reference.begin !== undefined &&
            reference.end !== undefined &&
            reference.begin > reference.end
        ) {
            throw new Error(
                `reference 的 begin 不能大于 end: ${reference.begin} > ${reference.end}`,
            );
        }
        // §3.2：引用不是正文子串时 begin/end 都不使用，只给一端的区间无法解释
        if ((reference.begin === undefined) !== (reference.end === undefined)) {
            throw new Error("reference 的 begin 与 end 必须同时给出或同时省略");
        }
        // 可选属性逐个补上，与解析侧的分支写法保持一致
        const attributes: Record<string, string> = {
            type: reference.type,
            uri: reference.uri,
        };
        if (reference.begin !== undefined) {
            attributes.begin = String(reference.begin);
        }
        if (reference.end !== undefined) {
            attributes.end = String(reference.end);
        }
        if (reference.anchor) {
            attributes.anchor = reference.anchor;
        }
        return XMPPElement.createElementNS(Reference.NS, "reference", attributes);
    }

    /** 校验偏移是可选的非负整数 */
    private static assertOffset(
        name: string,
        value: number | undefined,
    ): void {
        if (value === undefined) return;
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`reference 的 ${name} 必须是非负整数: ${value}`);
        }
    }

    /**
     * 把引用附加到消息上
     *
     * 引用是消息的注解，常与正文、回复等其它扩展共存；本方法只追加 `<reference/>`，
     * 不构造消息也不发送，调用方可用任意方式先组好消息。
     * @param message 目标消息元素
     * @param references 引用列表
     * @returns 同一个消息元素
     * @throws 引用带 `anchor` 且消息已包含 `<body/>`：§3.4 规定该消息不得包含正文
     */
    static appendReferences(
        message: XMPPElement,
        references: Iterable<MessageReference>,
    ): XMPPElement {
        const list = [...references];
        // §3.4：标注历史消息的消息不得包含正文
        if (
            list.some((reference) => reference.anchor) &&
            message.querySelector(":scope > body")
        ) {
            throw new Error("带 anchor 的引用所在消息不得包含正文（§3.4）");
        }
        for (const reference of list) {
            message.appendChild(Reference.createReferenceEl(reference));
        }
        return message;
    }

    /**
     * 在消息正文中定位一段文本并附加引用
     *
     * 调用方只需给出被引用的文本，区间由本方法按 XEP-0426 换算成 Unicode 码点；
     * 正文中出现多次时取第一次，需要其它位置请改用 `appendReferences` 自行给区间。
     * @param message 目标消息元素，查找范围为其直接子元素 `<body/>`
     * @param text 被引用的文本片段，必须非空且确实出现在正文中
     * @param reference 引用类型与被引用对象（`type`、`uri`），区间由本方法填写
     * @returns 同一个消息元素
     * @throws 消息缺少 `<body/>`、`text` 为空或正文中找不到时抛错
     */
    static appendTextReference(
        message: XMPPElement,
        text: string,
        reference: Omit<MessageReference, "begin" | "end" | "anchor">,
    ): XMPPElement {
        if (!text) throw new Error("引用文本不能为空");
        const body = message.querySelector(":scope > body")?.textContent;
        if (!body) throw new Error("消息没有正文，无法定位引用文本");
        const index = body.indexOf(text);
        if (index < 0) throw new Error(`正文中找不到引用文本: ${text}`);
        return Reference.appendReferences(message, [
            {
                ...reference,
                begin: XEP0426.toCodePointOffset(body, index),
                end: XEP0426.toCodePointOffset(body, index + text.length),
            },
        ]);
    }
}

export default Reference;
