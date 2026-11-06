import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { MsgType } from "@/stanza";
import type { Plugin } from "../types";
import logger from "@/log";
import { ChatState, type ChatStateValue } from "./chatState";

const log = logger.getLogger("XEP0085");

/**
 * XEP-0085: Chat State Notifications
 *
 * 发送与接收输入状态（composing/paused 等）。发送时机与节流由调用方控制：
 * 规范要求连续输入时不能重复发送同一个独立通知。
 * @see https://xmpp.org/extensions/xep-0085.html
 * @version 2.1 (2009-09-23)
 */
export class XEP0085 extends ChatState implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(ChatState.NS);
        this.connection.registerStanzaPlugin(
            ChatState.NS,
            ChatState.parseChatStateEl,
        );
    }

    /**
     * 发送聊天状态通知
     * @param to 通知接收者；群聊为房间 bare JID
     * @param state 聊天状态
     * @param type 消息类型，1:1 用 `chat`，群聊用 `groupchat`
     * @returns 已发送的消息元素
     */
    sendChatState(
        to: string | JID,
        state: ChatStateValue,
        type: MsgType = "chat",
    ) {
        if (type !== "chat" && type !== "groupchat") {
            log.warn(`聊天状态不应用于 ${type} 类型的消息（XEP-0085 §5.1）`);
        }
        if (type === "groupchat" && state === "gone") {
            log.warn("群聊中不建议发送 gone 状态（XEP-0085 §5.1）");
        }

        const message = ChatState.createChatStateMessage(to, state, type);
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0085: 本条消息携带的聊天状态 */
        chatState?: ChatStateValue;
    }
}

export default XEP0085;
