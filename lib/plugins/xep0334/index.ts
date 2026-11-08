import type Connection from "@/connection";
import type { Plugin } from "../types";
import { Hints, type MessageHint } from "./hints";

/**
 * XEP-0334: Message Processing Hints
 *
 * 在消息上附加路由提示，如「不要存档」「不要复制到其他资源」。
 * @see https://xmpp.org/extensions/xep-0334.html
 * @version 1.0.0 (2024-04-17)
 */
export class XEP0334 extends Hints implements Plugin {
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(Hints.NS, Hints.parseHintEl);
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0334: 消息处理提示 */
        hints?: MessageHint[];
    }
}

export default XEP0334;
