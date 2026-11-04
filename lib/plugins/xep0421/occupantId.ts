import { XMPPElement } from "@/ltx/Element";
import logger from "@/log";

const log = logger.getLogger("XEP0421");

/** `<occupant-id/>` 的解析结果 */
export interface OccupantID {
    /** 房间分配的稳定、不透明标识，最大 128 字符 */
    id: string;
}

/**
 * XEP-0421: Anonymous unique occupant identifiers for MUCs
 *
 * 半匿名 MUC 中由房间附加的稳定标识，用于在昵称变更、重连后
 * 识别同一住户。标识对客户端不透明，不能反推真实 JID。
 * @see https://xmpp.org/extensions/xep-0421.html
 * @version 1.0.1 (2025-04-09)
 */
export class OccupantId {
    static readonly NS = "urn:xmpp:occupant-id:0" as const;

    /**
     * 解析 `urn:xmpp:occupant-id:0` 命名空间下的 `<occupant-id/>`
     *
     * 未知元素与缺少 `id` 的标识无法使用，直接忽略。
     * @param occupantIdEl 待解析的元素
     * @throws 命名空间不符时抛错
     */
    static parseOccupantIdEl(
        occupantIdEl: XMPPElement,
    ): { occupantID?: OccupantID } {
        if (occupantIdEl.namespaceURI !== OccupantId.NS) {
            throw new Error(`非法的 occupant-id 命名空间: ${occupantIdEl.toXMLString()}`);
        }
        if (occupantIdEl.localName !== "occupant-id") {
            log.warn(`忽略未知的 occupant-id 元素: ${occupantIdEl.toXMLString()}`);
            return {};
        }

        const id = occupantIdEl.getAttribute("id");
        if (!id) {
            log.warn(`忽略缺少 id 的 occupant-id 元素: ${occupantIdEl.toXMLString()}`);
            return {};
        }
        return { occupantID: { id } };
    }
}

export default OccupantId;
