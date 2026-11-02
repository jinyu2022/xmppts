import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { Plugin } from "../types";
import { OOB, type OOBMessageOptions, type OOBData } from "./oob";

/**
 * XEP-0066: Out of Band Data
 *
 * 解析消息与出席中的 `jabber:x:oob` 元素，并提供发送方法。
 * @see https://xmpp.org/extensions/xep-0066.html
 * @version 1.6 (2026-07-08)
 */
export class XEP0066 implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(OOB.NS);
        this.connection.registerStanzaPlugin(
            OOB.NS,
            OOB.parseOobEl,
        );
    }

    /**
     * 发送携带 OOB URL 的消息
     * @param to 消息接收者
     * @param url 资源 URL
     * @param options 描述、正文与消息类型
     * @returns 已发送的消息元素
     */
    sendOOB(to: string | JID, url: string, options?: OOBMessageOptions) {
        const message = OOB.createOobMessage(to, url, options);
        this.connection.send(message);
        return message;
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0066: 本条消息携带的带外数据 */
        oob?: OOBData;
    }

    interface Presence {
        /** XEP0066: 本次出席携带的带外数据 */
        oob?: OOBData;
    }
}

export default XEP0066;
