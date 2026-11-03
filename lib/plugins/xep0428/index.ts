import type Connection from "@/connection";
import type { Plugin } from "../types";
import { Fallback, type FallbackInfo } from "./fallback";

/**
 * XEP-0428: Fallback Indication
 *
 * 标记消息正文或主题中仅供旧客户端显示的回退内容。
 * @see https://xmpp.org/extensions/xep-0428.html
 * @version 0.2.1 (2024-03-20)
 */
export class XEP0428 extends Fallback implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(Fallback.NS);
        this.connection.registerStanzaPlugin(
            Fallback.NS,
            Fallback.parseFallbackEl,
        );
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0428: 正文与主题中的回退区间 */
        fallbacks?: FallbackInfo[];
    }
}

export default XEP0428;
