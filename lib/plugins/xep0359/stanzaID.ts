import { XMPPElement } from "@/ltx";
import logger from "@/log";

const log = logger.getLogger("XEP0359");

export interface StableStanzaID {
    id: string;
    by?: string;
}

export class StanzaID {
    static readonly NS = "urn:xmpp:sid:0" as const;

    /**
     * 创建 `<origin-id/>` 元素，供发送方为消息分配唯一稳定 ID
     * @param id 指定的 ID，缺省时随机生成
     */
    static createOriginId(id: string = crypto.randomUUID()): XMPPElement {
        const el = XMPPElement.createElementNS(StanzaID.NS, "origin-id", {
            id,
        });
        return el;
    }

    static parseStanzaId(
        stanza: XMPPElement
    ): Record<"stanzaID" | "originID" | "referencedStanza", StableStanzaID> {
        if (stanza.namespaceURI !== StanzaID.NS)
            throw new Error(`不是stanzaId命名空间: ${stanza.toXMLString()}`);

        const tagNameMap = {
            "stanza-id": "stanzaID",
            "origin-id": "originID",
            "referenced-stanza": "referencedStanza",
        } as const;

        const tagName = tagNameMap[stanza.tagName as keyof typeof tagNameMap];
        if (!tagName) log.warn(`未知的 stanza-id 元素: ${stanza.tagName}`);
        const result = {} as StableStanzaID;
        result.id = stanza.getAttribute("id")!;
        const by = stanza.getAttribute("by");
        if (by) result.by = by;
        return {
            [tagName ?? stanza.tagName]: result,
        } as Record<"stanzaID" | "originID" | "referencedStanza", StableStanzaID>;
    }
}
