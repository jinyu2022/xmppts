import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";
import logger from "@/log";
import { StanzaID } from "../xep0359/stanzaID";
import { Fallback } from "../xep0428/fallback";
import { XEP0426 } from "../xep0426";

const log = logger.getLogger("XEP0461");

/** `<reply/>` 的解析结果 */
export interface MessageReply {
    /** 被回复消息作者的 JID；规范只要求 SHOULD，1:1 场景可为 bare JID */
    to?: string;
    /** 被回复消息的 ID；群聊中为房间分配的 stanza-id */
    id: string;
}

/**
 * XEP-0461: Message Replies
 * @see https://xmpp.org/extensions/xep-0461.html
 * @version 0.2.1 (2026-02-25)
 */
export class Reply {
    static readonly NS = "urn:xmpp:reply:0";
    /** XEP-0428 兼容性回退的命名空间 */
    static readonly FALLBACK_NS = Fallback.NS;

    /**
     * 解析 `urn:xmpp:reply:0` 命名空间下的 `<reply/>`
     *
     * 缺少 `id` 的 `<reply/>` 无法定位被回复消息，直接忽略。
     * @param replyEl 待解析的元素
     */
    static parseReplyEl(replyEl: XMPPElement): { reply?: MessageReply } {
        if (replyEl.namespaceURI !== Reply.NS) {
            throw new Error(`不是一个 reply 元素: ${replyEl.toXMLString()}`);
        }

        if (replyEl.localName !== "reply") {
            log.warn(`忽略未知的消息回复元素: ${replyEl.toXMLString()}`);
            return {};
        }

        const id = replyEl.getAttribute("id");
        if (!id) {
            log.warn(`忽略缺少 id 的 reply 元素: ${replyEl.toXMLString()}`);
            return {};
        }
        // 空的 to 属性不写入结果，避免把它当成有效 JID
        const to = replyEl.getAttribute("to");
        const reply: MessageReply = { id };
        if (to) reply.to = to;
        return { reply };
    }

    /**
     * 创建 `<reply/>` 元素
     * @param to 被回复消息作者的 JID，可为 undefined（规范只要求 SHOULD 携带）
     * @param id 被回复消息的 ID
     */
    static createReplyEl(to: string | JID | undefined, id: string) {
        return XMPPElement.createElementNS(Reply.NS, "reply", {
            ...(to ? { to: to.toString() } : {}),
            id,
        });
    }

    /**
     * 创建回复消息
     * @param to 回复的接收者
     * @param replyEl 已构造好的 `<reply/>` 元素
     * @param body 回复正文
     * @param type 消息类型
     * @param quotedBody 被引用消息的正文；提供时在正文前插入XEP-0393引用块并附加
     *   XEP-0428 回退（XEP-0461 §3.2），不支持 `<reply/>` 的客户端可直接看到被引用内容
     *   使用时无需提前加入 `>` 符号
     */
    static createReplyMessage(
        to: string | JID,
        replyEl: XMPPElement,
        body: string,
        type: MsgType,
        quotedBody?: string,
    ) {
        if (!quotedBody) {
            const message = Message.createMessage(to, body, type);
            message.appendChild(replyEl);
            return message;
        }

        // 引用块遵循 XEP-0393 §3.3：行首为 `>`，其后的第一个空白由解析方去掉
        const quoted = quotedBody
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        // end 是「引用块 + 一个换行」的码点数（XEP-0426），与下面的正文拼接一致；
        // quoted 本身不含这个换行
        const end = XEP0426.length(quoted) + 1;
        const message = Message.createMessage(to, `${quoted}\n${body}`, type);
        message.appendChild(replyEl);
        message.appendChild(
            Fallback.createFallbackEl({
                for: Reply.NS,
                body: [{ start: 0, end }],
            }),
        );
        return message;
    }

    /**
     * 从收到的消息推断引用，直接构造 `<reply/>`
     *
     * - `groupchat`：必须引用房间分配的 `<stanza-id/>`（XEP-0359），
     *   其 `by` 需等于房间 bare JID；缺少时无法回复。
     * - 其他类型：优先使用 `<origin-id/>`，否则使用 stanza 的 `id`。
     * @param message 被回复的消息
     * @returns 可直接附加到回复消息的 `<reply/>`（`to` 为发送者 full JID）
     * @throws 群聊消息缺少房间分配的 stanza-id，或消息没有任何可用 ID
     */
    static getReferenceEl(message: Message): XMPPElement {
        const to = message.from.full;

        if (message.type === "groupchat") {
            const room = message.from.bare;
            // 不能信任，自行解析xml更稳妥
            const stanzaId = Array.from(
                message.xml.getElementsByTagNameNS(StanzaID.NS, "stanza-id"),
            ).find((el) => el.getAttribute("by") === room);
            const id = stanzaId?.getAttribute("id");
            if (!id) {
                throw new Error(
                    "群聊消息缺少房间分配的 stanza-id，无法回复（XEP-0461 §3.1）",
                );
            }
            return Reply.createReplyEl(to, id);
        }

        const originId = message.xml.getElementsByTagNameNS(
            StanzaID.NS,
            "origin-id",
        )[0]?.getAttribute("id");
        const id = originId ?? message.id;
        if (!id) {
            throw new Error("消息缺少可用于回复的 ID");
        }
        return Reply.createReplyEl(to, id);
    }
}

export default Reply;
