import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { Message, MsgType } from "@/stanza";
import type { Plugin } from "../types";
import { Reply, type MessageReply } from "./reply";

/**
 * XEP-0461: Message Replies
 *
 * 通过 `<reply to="..." id="..."/>` 指示当前消息是对某条消息的回复。
 * @see https://xmpp.org/extensions/xep-0461.html
 * @version 0.2.1 (2026-02-25)
 */
export class XEP0461 extends Reply implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Reply.NS);
        this.connection.registerStanzaPlugin(Reply.NS, Reply.parseReplyEl);
    }

    /**
     * 回复一条已收到的消息
     *
     * 收件人、引用目标、被引用 ID 与消息类型均从原消息推断：
     * 群聊回复发往房间 bare JID 并引用房间分配的 stanza-id，
     * 1:1 回复发往发送者 full JID。
     * @param originalMessage 被回复的消息
     * @param body 回复正文
     * @param quote 是否在正文中加入引用块与 XEP-0428 回退，默认关闭
     * @returns 已发送的消息元素
     * @throws 原消息缺少可引用的 ID
     */
    reply(originalMessage: Message, body: string, quote = false) {
        const replyEl = Reply.getReferenceEl(originalMessage);
        const isGroupchat = originalMessage.type === "groupchat";
        const to = isGroupchat
            ? originalMessage.from.bare
            : originalMessage.from.full;
        const message = Reply.createReplyMessage(
            to,
            replyEl,
            body,
            originalMessage.type,
            quote ? originalMessage.body ?? undefined : undefined,
        );
        this.connection.send(message);
        return message;
    }

    /**
     * 显式指定引用目标发送回复
     * @param to 回复的接收者
     * @param replyTo 被回复消息作者的 JID
     * @param replyId 被回复消息的 ID；群聊中应为房间分配的 stanza-id
     * @param body 回复正文
     * @param type 消息类型，应与原始消息一致
     * @returns 已发送的消息元素
     */
    sendReply(
        to: string | JID,
        replyTo: string | JID | undefined,
        replyId: string,
        body: string,
        type: MsgType,
    ) {
        const message = Reply.createReplyMessage(
            to,
            Reply.createReplyEl(replyTo, replyId),
            body,
            type,
        );
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0461: 本条消息回复的引用目标 */
        reply?: MessageReply;
    }
}

export default XEP0461;
