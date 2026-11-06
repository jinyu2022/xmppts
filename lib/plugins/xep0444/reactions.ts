import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0444");

/** `<reactions/>` 的解析结果 */
export interface MessageReactions {
    /** 被反应消息的 ID；群聊中为房间分配的 stanza-id */
    id: string;
    /** 去重后的反应文本；空数组表示移除全部反应 */
    values: string[];
}

/**
 * XEP-0444: Message Reactions
 *
 * 当前只过滤空串，不校验 emoji 合法性
 * @see https://xmpp.org/extensions/xep-0444.html
 * @version 0.2.1 (2024-04-15)
 */
export class Reactions {
    static readonly NS = "urn:xmpp:reactions:0" as const;
    /** XEP-0334 消息处理提示的命名空间，用于 `<store/>` */
    static readonly HINTS_NS = "urn:xmpp:hints" as const;

    /**
     * 解析 `urn:xmpp:reactions:0` 命名空间下的 `<reactions/>`
     *
     * 规范要求接收方忽略重复反应（§4 Business Rules）；空 `<reaction/>`
     * 无法构成反应，同样忽略。emoji 合法性不在解析层校验（见类 TODO）。
     * @param reactionsEl 待解析的元素
     */
    static parseReactionsEl(
        reactionsEl: XMPPElement,
    ): { reactions?: MessageReactions } {
        if (reactionsEl.namespaceURI !== Reactions.NS) {
            throw new Error(`不是一个 reactions 元素: ${reactionsEl.toXMLString()}`);
        }
        if (reactionsEl.localName !== "reactions") {
            log.warn(`忽略未知的消息反应元素: ${reactionsEl.toXMLString()}`);
            return {};
        }

        const id = reactionsEl.getAttribute("id");
        if (!id) {
            // 缺 id 的反应无法应用；忽略该元素，保留消息的正文与其他扩展
            log.warn(`忽略缺少 id 的 reactions 元素: ${reactionsEl.toXMLString()}`);
            return {};
        }

        const values = new Set<string>();
        for (const child of reactionsEl.children) {
            if (child.namespaceURI !== Reactions.NS || child.localName !== "reaction") {
                continue;
            }
            if (child.textContent) values.add(child.textContent);
        }
        return { reactions: { id, values: Array.from(values) } };
    }

    /**
     * 创建 `<reactions/>` 元素
     * @param id 被反应消息的 ID；群聊中应为房间分配的 stanza-id
     * @param values 反应文本；重复值与空串会被忽略，空数组表示移除全部反应
     */
    static createReactionsEl(id: string, values: Iterable<string>) {
        const reactions = XMPPElement.createElementNS(Reactions.NS, "reactions", {
            id,
        });
        // 规范要求同一 <reactions/> 内不得重复；暂不校验 emoji 合法性（见类 TODO），只过滤空串
        for (const value of new Set(values)) {
            if (!value) continue;
            const reaction = XMPPElement.createElement("reaction");
            reaction.textContent = value;
            reactions.appendChild(reaction);
        }
        return reactions;
    }

    /**
     * 创建携带反应的消息
     * @param to 反应接收者
     * @param id 被反应消息的 ID
     * @param values 反应文本
     * @param type 消息类型；§4 要求为 `chat` 或 `groupchat`
     * @param store 是否附加 XEP-0334 `<store/>` 提示
     */
    static createReactionsMessage(
        to: string | JID,
        id: string,
        values: Iterable<string>,
        type: MsgType,
        store = true,
    ) {
        const message = Message.createMessage(to, undefined, type);
        message.appendChild(Reactions.createReactionsEl(id, values));
        // §4 SHOULD 附加 `<store/>` 提示，原消息带 `<no-store/>` 时应传 store = false
        if (store) {
            message.appendChild(
                XMPPElement.createElementNS(Reactions.HINTS_NS, "store"),
            );
        }
        return message;
    }

    // TODO: §4 要求 `<reaction/>` 的值应能显示为单个 emoji（UTS #51）。
}

export default Reactions;
