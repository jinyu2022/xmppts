import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";

/**
 * XEP-0308: Last Message Correction
 *
 * 提供消息更正功能，允许用户更正已发送的消息。
 * @see https://xmpp.org/extensions/xep-0308.html
 * @version 1.2.1 (2022-05-17)
 */
export class Correction {
    static readonly NS = "urn:xmpp:message-correct:0";

    /**
     * 解析消息更正元素
     *
     * 从 XML 元素中解析更正请求信息。
     *
     * @param replaceEl - 要解析的更正 XML 元素
     * @throws {Error} 当元素命名空间不合法或缺少必要属性时抛出错误
     */
    static parseReplaceEl(replaceEl: XMPPElement) {
        if (replaceEl.namespaceURI !== Correction.NS) {
            throw new Error(`非法命名空间的消息更正元素: ${replaceEl.toXMLString()}`);
        }

        const id = replaceEl.getAttribute("id");
        if (!id) {
            throw new Error(`消息更正元素缺少 id: ${replaceEl.toXMLString()}`);
        }

        return {
            replace: { id },
        };
    }

    /**
     * 创建消息更正元素
     *
     * 创建一个 <replace/> 元素，指向要被更正的原消息 ID。
     *
     * @param id - 要更正的原消息的唯一标识符
     * @returns 返回创建的更正 XML 元素
     */
    static createReplaceEl(id: string) {
        const replace = XMPPElement.createElementNS(Correction.NS, "replace", {
            id,
        });
        return replace;
    }

    /**
     * 创建包含更正内容的完整消息节
     *
     * 创建一个新的消息节，包含更正后的消息体以及指向原消息的 <replace/> 元素。
     *
     * @param to - 消息接收者的 JID
     * @param replaceId - 要更正的原消息 ID
     * @param newBody - 更正后的消息正文
     * @param type - 消息类型，默认为 "chat"
     * @returns 返回包含更正内容的可发送的消息节
     */
    static createCorrectionMessageEl(
        to: string | JID,
        replaceId: string,
        newBody: string,
        type: MsgType = "chat",
    ) {
        const message = Message.createMessage(to, newBody, type);
        message.appendChild(Correction.createReplaceEl(replaceId));
        return message;
    }

    /**
     * 检查消息是否包含更正标记
     *
     * @param msg - 要检查的消息对象
     * @returns 如果消息包含 <replace/> 更正标记则返回 true
     */
    static isCorrection(msg: Message) {
        return msg.replace != null;
    }
}

export default Correction;
