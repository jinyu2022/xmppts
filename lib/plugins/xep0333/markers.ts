import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0333");

/**
 * XEP-0333: Displayed Markers（原 Chat Markers）
 *
 * @see https://xmpp.org/extensions/xep-0333.html
 * @version 1.0.0 (2024-04-17)
 */
export class Markers {
    static readonly NS = "urn:xmpp:chat-markers:0" as const;

    /**
     * 解析 `urn:xmpp:chat-markers:0` 命名空间下的标记元素
     *
     * 早期草案的 `<received/>`、`<acknowledged/>` 与缺少 `id` 的 `<displayed/>`
     * 无法使用，直接忽略，避免影响同一消息的正文与其他扩展。
     * @param markerEl 待解析的元素
     */
    static parseMarkerEl(
        markerEl: XMPPElement,
    ): { markable?: true; displayed?: { id: string } } {
        if (markerEl.namespaceURI !== Markers.NS) {
            throw new Error(`不是一个标记元素: ${markerEl.toXMLString()}`);
        }
        switch (markerEl.localName) {
            case "markable":
                return { markable: true };
            case "displayed": {
                const id = markerEl.getAttribute("id");
                if (!id) {
                    log.warn(
                        `忽略缺少 id 的 displayed 标记: ${markerEl.toXMLString()}`,
                    );
                    return {};
                }
                return { displayed: { id } };
            }
            default:
                return {};
        }
    }

    /** 创建请求已读标记的 `<markable/>`，附加到待发送消息上 */
    static createMarkableEl() {
        return XMPPElement.createElementNS(Markers.NS, "markable");
    }

    /**
     * 创建已读标记 `<displayed/>`
     * @param id 被显示消息的 ID；群聊中应为房间分配的 stanza-id（XEP-0333 §4.3）
     * @throws `id` 为空时抛错（§4.2 要求 `<displayed/>` 必须带 id）
     */
    static createDisplayedEl(id: string) {
        if (!id) {
            throw new Error("已显示标记的 id 不能为空");
        }
        return XMPPElement.createElementNS(Markers.NS, "displayed", { id });
    }

    /**
     * 创建只含已读标记的消息（规范示例中不带 body）
     * @param to 标记接收者；1:1 聊天可为 bare JID，群聊为房间 bare JID
     * @param id 被显示消息的 ID
     * @param type 消息类型，应与原始消息一致；群聊标记必须用 `groupchat`
     */
    static createDisplayedMessage(
        to: string | JID,
        id: string,
        type: MsgType,
    ) {
        const message = Message.createMessage(to, undefined, type);
        message.appendChild(Markers.createDisplayedEl(id));
        return message;
    }
}

export default Markers;
