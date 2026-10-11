import { XMPPElement } from "@/ltx/Element";

/** XEP-0184 回执：`<request/>` 无 id，`<received/>` 的 id 必填 */
type Receipts =
    | { type: "request" }
    | { type: "received"; id: string };

export class MessageReceipts {
    static readonly NS = "urn:xmpp:receipts" as const;

    /**
     * 解析 `urn:xmpp:receipts` 命名空间下的 `<request/>` / `<received/>`
     * @param xml 待解析的回执元素
     * @throws 命名空间不符、元素名未知，或 `<received/>` 缺少 `id` 时抛错
     */
    static parseReceipts(xml: XMPPElement): { receipts: Receipts } {
        if (xml.namespaceURI !== MessageReceipts.NS)
            throw new Error(`不是消息回执命名空间: ${xml.toXMLString()}`);
        switch (xml.localName) {
            case "request":
                return { receipts: { type: "request" } };
            case "received": {
                const id = xml.getAttribute("id");
                if (!id) throw new Error(`received 回执缺少 id: ${xml.toXMLString()}`);
                return { receipts: { type: "received", id } };
            }
            default:
                throw new Error(`未知的消息回执元素: ${xml.toXMLString()}`);
        }
    }

    // 重载签名
    static createReceiptsEl(type: "request"): XMPPElement;
    static createReceiptsEl(type: "received", id: string): XMPPElement;
    
    // 实现
    static createReceiptsEl(type: "received" | "request", id?: string): XMPPElement {
        const message = XMPPElement.createElementNS(MessageReceipts.NS, type);
        if (type === "received") {
            if (!id) throw new Error("回执响应需要提供消息ID");
            message.setAttribute("id", id);
        }
        return message;
    }
}

declare module "@/stanza" {
    interface Message {
        receipts?: Receipts
    }
}