import type Connection from "@/connection";
import type { JID } from "@/JID";
import { Message, type MsgType } from "@/stanza";
import type { Plugin } from "../types";
import { Correction } from "./correction";

/**
 * XEP-0308: Last Message Correction
 *
 * 实现 XMPP 消息更正扩展协议，允许用户更正已发送的消息。
 * @see https://xmpp.org/extensions/xep-0308.html
 * @version 1.2.1 (2022-05-17)
 */
export class XEP0308 extends Correction implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Correction.NS);
        this.connection.registerStanzaPlugin(Correction.NS, Correction.parseReplaceEl);

        this.connection.registerEventPlugin("message:correct", {
            tagName: "message",
            matcher: (message) => message.replace != null,
        });
    }

    /**
     * 发送消息更正请求
     *
     * 创建一个包含更正内容的消息节并发送。该消息包含更正后的正文
     * 和指向原消息的 <replace/> 元素。
     *
     * @param to - 消息接收者的 JID（裸 JID 或完整 JID）
     * @param replaceId - 要更正的原消息 ID
     * @param newBody - 更正后的消息正文
     * @param type - 消息类型，默认为 "chat"
     */
    correctMessage(
        to: string | JID,
        replaceId: string,
        newBody: string,
        type?: MsgType,
    ): void;
    /**
     * 发送消息更正请求（基于原消息对象）
     *
     * 从原始 Message 对象中自动提取 `to`、`type` 和 `id`，
     * 无需手动指定各参数。
     *
     * @param originalMessage - 要更正的原消息对象
     * @param newBody - 更正后的消息正文
     */
    correctMessage(
        originalMessage: Message,
        newBody: string,
    ): void;
    correctMessage(
        toOrMessage: string | JID | Message,
        replaceIdOrNewBody: string,
        newBodyOrType?: string,
        type?: MsgType,
    ): void {
        let to: string | JID;
        let replaceId: string;
        let newBody: string;
        let msgType: MsgType;

        if (toOrMessage instanceof Message) {
            if (!toOrMessage.to) throw new Error("原始消息缺少 to 属性");
            if (!toOrMessage.id) throw new Error("原始消息缺少 id 属性，无法更正");
            to = toOrMessage.to;
            replaceId = toOrMessage.id;
            newBody = replaceIdOrNewBody;
            msgType = toOrMessage.type ?? "chat";
        } else {
            to = toOrMessage;
            replaceId = replaceIdOrNewBody;
            newBody = newBodyOrType ?? "";
            msgType = type ?? "chat";
        }

        const messageEl = XEP0308.createCorrectionMessageEl(to, replaceId, newBody, msgType);
        this.connection.send(messageEl);
        
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0308: 消息更正标记，包含被更正的原消息 ID */
        replace?: { id: string };
    }
}

declare module "../../connection" {
    interface SocketEventMap {
        /** XEP0308: 收到消息更正 */
        "message:correct": Message & { replace: { id: string } };
    }
}

export default XEP0308;
