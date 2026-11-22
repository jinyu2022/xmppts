import type Connection from "@/connection";
import type { JID } from "@/JID";
import { Message, type MsgType } from "@/stanza";
import type { Plugin } from "../types";
import { Reference, type MessageReference } from "./reference";

/**
 * XEP-0372: References
 *
 * 解析消息中的引用（@提及、数据引用等），并提供发送方法。
 * @see https://xmpp.org/extensions/xep-0372.html
 * @version 0.5.0 (2020-12-09)
 */
export class XEP0372 extends Reference implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Reference.NS);
        this.connection.registerStanzaPlugin(
            Reference.NS,
            Reference.parseReferenceEl,
        );
    }

    /**
     * 发送携带引用的消息
     *
     * 等价于 `Message.createMessage(to, body, type)` 后调用 `Reference.appendReferences` 再发送；
     * 消息还需携带回复、OOB 等其它扩展时，自行组好消息后用静态方法附加。
     * @param to 消息接收者；群聊为房间 bare JID
     * @param body 消息正文；标注历史消息（引用带 `anchor`）时不得生成 `<body/>`，传 `undefined` 或空串均可
     * @param references 引用列表，`begin`/`end` 按 Unicode 码点计
     * @param type 消息类型，群聊使用 `groupchat`
     * @returns 已发送的消息元素
     * @throws 任一引用带 `anchor` 且消息已生成 `<body/>` 时抛错（§3.4）
     */
    sendReferences(
        to: string | JID,
        body: string | undefined,
        references: Iterable<MessageReference>,
        type: MsgType,
    ) {
        const message = Reference.appendReferences(
            Message.createMessage(to, body, type),
            references,
        );
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0372: 本条消息携带的引用 */
        references?: MessageReference[];
    }
}

export default XEP0372;
