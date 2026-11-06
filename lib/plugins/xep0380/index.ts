import type Connection from "@/connection";
import type { Plugin } from "../types";
import { EME, type EncryptionInfo } from "./eme";

/**
 * XEP-0380: Explicit Message Encryption
 *
 * 标记消息使用的端到端加密机制，供不支持该机制的对端提示用户。
 * @see https://xmpp.org/extensions/xep-0380.html
 * @version 0.4.0 (2021-11-18)
 */
export class XEP0380 extends EME implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(EME.NS);
        this.connection.registerStanzaPlugin(
            EME.NS,
            EME.parseEncryptionEl,
        );
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0380: 本条消息使用的加密机制 */
        eme?: EncryptionInfo;
    }
}

export default XEP0380;
