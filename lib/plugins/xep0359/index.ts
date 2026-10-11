import { StanzaID, type StableStanzaID } from "./stanzaID";
import type { Plugin } from "../types";
import type Connection from "@/connection";
/**
 * XEP-0359: Unique and Stable Stanza IDs  
 * @see https://xmpp.org/extensions/xep-0359.html
 * @version 0.7.0 (2023-02-20)
 */
export class XEP0359 extends StanzaID implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(StanzaID.NS);
        this.connection.registerStanzaPlugin(StanzaID.NS, StanzaID.parseStanzaId);
    }
}

declare module "@/stanza" {
    interface Message {
        /** XEP0359: 服务器分配的稳定 ID */
        stanzaID?: Required<StableStanzaID>;
        /** XEP0359: 发送方分配的唯一 ID */
        originID?: Omit<StableStanzaID, "by">;
        /** XEP0359: 被引用的节 ID */
        referencedStanza?: StableStanzaID;
    }
}

export default XEP0359;