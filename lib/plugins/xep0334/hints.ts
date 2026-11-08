import { XMPPElement } from "@/ltx/Element";
import { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0334");

/** 存储类提示：三者语义互斥，一条消息最多带一个 */
export type StoreHint = "store" | "no-store" | "no-permanent-store";

/**
 * 消息上可能出现的提示，取值即元素本地名
 *
 * `store` 建议存档该消息，即使它没有正文；`no-store` 不得永久或临时存储；
 * `no-permanent-store` 不得永久存储但允许为投递临时存储；
 * `no-copy` 不得复制到其他地址（如 XEP-0280 Carbons）。
 */
export type MessageHint = StoreHint | "no-copy";

/**
 * 写入端的提示：至少给出一个，存储类提示互斥，`no-copy` 可与任意存储提示组合
 *
 * 两种顺序等价，生成的元素按传入顺序排列。
 */
export type HintsInput =
    | readonly [StoreHint]
    | readonly [StoreHint, "no-copy"]
    | readonly ["no-copy", StoreHint]
    | readonly ["no-copy"];

/** 规范定义的提示元素本地名 */
const HINT_TAGS: readonly MessageHint[] = [
    "store",
    "no-store",
    "no-copy",
    "no-permanent-store",
];

/**
 * XEP-0334: Message Processing Hints
 *
 * 在消息上附加路由提示，如「不要存档」「不要复制到其他资源」。
 * @see https://xmpp.org/extensions/xep-0334.html
 * @version 1.0.0 (2024-04-17)
 */
export class Hints {
    static readonly NS = "urn:xmpp:hints" as const;

    /**
     * 解析 `urn:xmpp:hints` 命名空间下的单个提示元素
     *
     * 一次只返回当前元素：同一条消息可携带多个提示，框架会对每个提示元素各调用一次
     * @param hintEl 待解析的提示元素
     * @returns 只含当前元素本地名的数组，未知提示原样返回
     */
    static parseHintEl(hintEl: XMPPElement): { hints?: MessageHint[] } {
        if (hintEl.namespaceURI !== Hints.NS) {
            throw new Error(`不是一个处理提示元素: ${hintEl.toXMLString()}`);
        }
        // 宽松处理，不校验
        return { hints: [hintEl.localName as MessageHint] };
    }

    /**
     * 构造提示元素
     * @param hints 要附加的提示
     * @returns 元素数组，顺序与 `hints` 一致，重复项只保留首个
     */
    static createHintEls(hints: readonly MessageHint[]): XMPPElement[] {
        const elements: XMPPElement[] = [];
        const seen = new Set<MessageHint>();
        for (const hint of hints) {
            // 未知值与重复项都不生成元素：前者是调用方写错名字，后者在规范里没有意义
            if (!HINT_TAGS.includes(hint)) {
                log.warn(`忽略未知的提示: ${hint}`);
                continue;
            }
            if (seen.has(hint)) {
                log.warn(`忽略重复的提示: ${hint}`);
                continue;
            }
            seen.add(hint);
            elements.push(XMPPElement.createElementNS(Hints.NS, hint));
        }
        return elements;
    }

    /**
     * 把提示附加到消息上，覆盖已有的提示元素
     * @param message 目标消息元素
     * @param hints 要附加的提示；传 `null` 为清除消息上已有的提示
     * @throws 对 bare JID、未指定收件人或收件人不是合法 JID 的消息附加 `no-copy` 时（§4）
     */
    static applyHints(
        message: XMPPElement,
        hints: HintsInput | null,
    ): void {
        const list: readonly MessageHint[] = hints ?? [];

        // no-copy 只对完整 JID 有意义：bare JID 的投递本身就可能复制到多个资源（§4）
        if (list.includes("no-copy")) {
            const to = message.getAttribute("to");
            if (!to || !new JID(to).resource) {
                throw new Error(
                    "no-copy 提示只能用于收件人为完整 JID 的消息",
                );
            }
        }
        // 移除已有的提示元素，避免重复
        for (const child of Array.from(message.children)) {
            if (child.namespaceURI === Hints.NS) message.removeChild(child);
        }
        for (const element of Hints.createHintEls(list)) {
            message.appendChild(element);
        }
    }
}
