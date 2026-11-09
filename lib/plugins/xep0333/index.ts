import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { MsgType } from "@/stanza";
import type { Plugin } from "../types";
import { Markers } from "./markers";

/**
 * XEP-0333: Displayed Markers
 *
 * 发送与接收“已显示”标记（俗称已读回执）。发送方在消息上附加
 * `<markable/>` 请求标记，接收方用 `<displayed/>` 回应。
 * @see https://xmpp.org/extensions/xep-0333.html
 * @version 1.0.0 (2024-04-17)
 */
export class XEP0333 extends Markers implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Markers.NS);
        this.connection.registerStanzaPlugin(Markers.NS, Markers.parseMarkerEl);
    }

    /**
     * 发送已读标记
     * @param to 标记接收者；1:1 聊天可为 bare JID，群聊为房间 bare JID
     * @param id 被显示消息的 ID；群聊中应为房间分配的 stanza-id
     * @param type 消息类型，应与原始消息一致；群聊标记必须用 `groupchat`
     * @returns 已发送的消息元素
     */
    sendDisplayed(to: string | JID, id: string, type: MsgType) {
        const message = Markers.createDisplayedMessage(to, id, type);
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    export interface Message {
        /** XEP0333: 发送方请求已读标记 */
        markable?: true;
        /** XEP0333: 已显示标记，`id` 为被显示消息的 ID */
        displayed?: { id: string };
    }
}

export default XEP0333;
