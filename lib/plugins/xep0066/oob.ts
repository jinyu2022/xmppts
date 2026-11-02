import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import type { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0066");

/** `<x xmlns="jabber:x:oob"/>` 的解析结果 */
export interface OOBData {
    /** 资源 URL；规范要求 `<url/>` 必须存在 */
    url: string;
    /** 可选的资源描述 */
    desc?: string;
}

/** {@link OOB.createOobMessage} 的选项 */
export interface OOBMessageOptions {
    /** 资源描述 */
    desc?: string;
    /** 消息正文，供不支持 OOB 的客户端显示 */
    body?: string;
    /** 消息类型，默认 `chat` */
    type?: MsgType;
}

/**
 * XEP-0066: Out of Band Data（`jabber:x:oob` 部分）
 *
 * 在消息或出席中携带资源 URL。规范中的 `jabber:iq:oob` 是旧式 IQ 文件传输，
 * 本实现不涉及。
 * @see https://xmpp.org/extensions/xep-0066.html
 * @version 1.6 (2026-07-08)
 */
export class OOB {
    static readonly NS = "jabber:x:oob";

    /**
     * 解析 `jabber:x:oob` 命名空间下的 `<x/>`
     *
     * 缺少 `<url/>` 或元素名不是 `x` 时忽略并记录警告，
     * 不影响同一消息的正文与其他扩展。
     * @param oobEl 待解析的元素
     * @throws 命名空间不符时抛错
     */
    static parseOobEl(oobEl: XMPPElement): { oob?: OOBData } {
        if (oobEl.namespaceURI !== OOB.NS) {
            throw new Error(`非法的 OOB 元素: ${oobEl.toXMLString()}`);
        }
        if (oobEl.localName !== "x") {
            log.warn(`忽略未知的 OOB 元素: ${oobEl.toXMLString()}`);
            return {};
        }

        // 规范要求 url/desc 是 x 的直接子元素
        const url = oobEl.querySelector(":scope > url")?.textContent;
        const desc = oobEl.querySelector(":scope > desc")?.textContent;
        if (!url) {
            log.warn(`忽略缺少 url 的 OOB 元素: ${oobEl.toXMLString()}`);
            return {};
        }
        return { oob: desc ? { url, desc } : { url } };
    }

    /**
     * 创建 `<x xmlns="jabber:x:oob"/>`
     * @param url 资源 URL
     * @param desc 可选的资源描述
     */
    static createOobEl(url: string, desc?: string) {
        const oob = XMPPElement.createElementNS(OOB.NS, "x");
        const urlEl = XMPPElement.createElement("url");
        urlEl.textContent = url;
        oob.appendChild(urlEl);
        if (desc) {
            const descEl = XMPPElement.createElement("desc");
            descEl.textContent = desc;
            oob.appendChild(descEl);
        }
        return oob;
    }

    /**
     * 创建携带 OOB 数据的消息
     * @param to 消息接收者
     * @param url 资源 URL
     * @param options 描述、正文与消息类型
     */
    static createOobMessage(
        to: string | JID,
        url: string,
        options?: OOBMessageOptions,
    ) {
        const message = Message.createMessage(
            to,
            options?.body,
            options?.type ?? "chat",
        );
        message.appendChild(OOB.createOobEl(url, options?.desc));
        return message;
    }
}

export default OOB;
