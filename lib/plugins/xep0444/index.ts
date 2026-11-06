import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { MsgType } from "@/stanza";
import type { Plugin } from "../types";
import { Reactions, type MessageReactions } from "./reactions";

/**
 * XEP-0444: Message Reactions
 *
 * 用 `<reactions id="..."><reaction>👋</reaction></reactions>` 对消息作出反应；
 * 每次发送完整的反应集合，空集合表示移除全部反应。
 * @see https://xmpp.org/extensions/xep-0444.html
 * @version 0.2.1 (2024-04-15)
 */
export class XEP0444 extends Reactions implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Reactions.NS);
        this.connection.registerStanzaPlugin(
            Reactions.NS,
            Reactions.parseReactionsEl,
        );
    }

    /**
     * 发送消息反应
     * @param to 反应接收者；群聊为房间 bare JID
     * @param messageId 被反应消息的 ID；群聊中应为房间分配的 stanza-id
     * @param values 反应文本；发送完整集合，空数组表示移除全部反应
     * @param type 消息类型；§4 要求为 `chat` 或 `groupchat`
     * @param store 是否附加 XEP-0334 `<store/>` 提示，默认附加
     * @returns 已发送的消息元素
     */
    sendReactions(
        to: string | JID,
        messageId: string,
        values: Iterable<string>,
        type: MsgType,
        store = true,
    ) {
        const message = Reactions.createReactionsMessage(
            to,
            messageId,
            values,
            type,
            store,
        );
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0444: 对某条消息的反应集合 */
        reactions?: MessageReactions;
    }
}

export default XEP0444;
