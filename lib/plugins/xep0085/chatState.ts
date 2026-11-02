import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0085");

/** XEP-0085 定义的聊天状态 */
export type ChatStateValue =
    | "active"
    | "inactive"
    | "gone"
    | "composing"
    | "paused";

/**
 * XEP-0085: Chat State Notifications
 *
 * 通过消息上的子元素通知对话状态；一条消息最多携带一个状态。
 * @see https://xmpp.org/extensions/xep-0085.html
 * @version 2.1 (2009-09-23)
 */
export class ChatState {
    static readonly NS = "http://jabber.org/protocol/chatstates";
    /** 规范定义的全部状态 */
    static readonly STATES: ReadonlySet<ChatStateValue> = new Set([
        "active",
        "inactive",
        "gone",
        "composing",
        "paused",
    ]);

    /**
     * 解析 `http://jabber.org/protocol/chatstates` 命名空间下的状态元素
     *
     * 同一命名空间下的未知元素（未来扩展或对端错误）会被忽略，
     * 避免影响同一消息的正文。
     * @param chatStateEl 待解析的元素
     * @throws 命名空间不符时抛错
     */
    static parseChatStateEl(
        chatStateEl: XMPPElement,
    ): { chatState?: ChatStateValue } {
        if (chatStateEl.namespaceURI !== ChatState.NS) {
            throw new Error(
                `非法的聊天状态命名空间: ${chatStateEl.toXMLString()}`,
            );
        }
        const name = chatStateEl.localName as ChatStateValue;
        if (!ChatState.STATES.has(name)) {
            log.warn(`忽略未知的聊天状态: ${chatStateEl.toXMLString()}`);
            return {};
        }
        return { chatState: name };
    }

    /**
     * 创建状态元素，附加到待发送的消息上
     * @param state 聊天状态
     * @throws 状态不在规范定义范围内时抛错
     */
    static createChatStateEl(state: ChatStateValue) {
        if (!ChatState.STATES.has(state)) {
            throw new Error(`未知的聊天状态: ${state}`);
        }
        return XMPPElement.createElementNS(ChatState.NS, state);
    }

    /**
     * 创建只含聊天状态的消息（独立通知）
     * @param to 通知接收者；群聊为房间 bare JID
     * @param state 聊天状态
     * @param type 消息类型，1:1 用 `chat`，群聊用 `groupchat`
     */
    static createChatStateMessage(
        to: string | JID,
        state: ChatStateValue,
        type: MsgType = "chat",
    ) {
        const message = Message.createMessage(to, undefined, type);
        message.appendChild(ChatState.createChatStateEl(state));
        return message;
    }
}

export default ChatState;
