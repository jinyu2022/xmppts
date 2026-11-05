import { XMPPElement } from "@/ltx/Element";
import logger from "@/log";

const log = logger.getLogger("XEP0380");

/** `<encryption/>` 的解析结果 */
export interface EncryptionInfo {
    /** 加密机制的主命名空间 */
    namespace: string;
    /** 机制的人类可读名称；已知机制不携带 */
    name?: string;
}

/**
 * XEP-0380: Explicit Message Encryption
 *
 * 用机器可读的元素标记消息使用的端到端加密机制。
 * @see https://xmpp.org/extensions/xep-0380.html
 * @version 0.4.0 (2021-11-18)
 */
export class EME {
    static readonly NS = "urn:xmpp:eme:0" as const;
    /** 规范列出的已知机制：发送时不应携带 name（§4） */
    static readonly KNOWN_MECHANISMS: Readonly<Record<string, string>> = {
        "urn:xmpp:otr:0": "OTR",
        "jabber:x:encrypted": "Legacy OpenPGP",
        "urn:xmpp:openpgp:0": "OpenPGP for XMPP",
        "eu.siacs.conversations.axolotl": "OMEMO",
        "urn:xmpp:omemo:1": "OMEMO 1",
        "urn:xmpp:omemo:2": "OMEMO 2",
    };

    /**
     * 解析 `urn:xmpp:eme:0` 命名空间下的 `<encryption/>`
     *
     * `namespace` 是必需属性，缺失时记录警告并忽略。
     * @param encryptionEl 待解析的元素
     */
    static parseEncryptionEl(
        encryptionEl: XMPPElement,
    ): { eme?: EncryptionInfo } {
        if (encryptionEl.namespaceURI !== EME.NS) {
            throw new TypeError(`非法的加密标记命名空间: ${encryptionEl.toXMLString()}`);
        }
        if (encryptionEl.localName !== "encryption") {
            log.warn(`忽略非法的加密标记元素: ${encryptionEl.toXMLString()}`);
            return {};
        }
        const namespace = encryptionEl.getAttribute("namespace");
        if (!namespace) {
            log.warn(`忽略缺少 namespace 的加密标记: ${encryptionEl.toXMLString()}`);
            return {};
        }

        const eme: EncryptionInfo = { namespace };
        const name = encryptionEl.getAttribute("name");
        if (name) eme.name = name;
        return { eme };
    }

    /**
     * 构造 `<encryption/>`
     *
     * 已知机制的 `name` 不应携带（§4）；传入时忽略并记录警告。
     * @param info 加密机制
     * @throws `namespace` 为空时
     */
    static createEncryptionEl(info: EncryptionInfo): XMPPElement {
        if (!info.namespace) {
            throw new Error("encryption 的 namespace 属性不能为空");
        }
        const encryptionEl = XMPPElement.createElementNS(EME.NS, "encryption", {
            namespace: info.namespace,
        });

        if (info.name) {
            const knownName = EME.getMechanismName(info.namespace);
            if (knownName) {
                log.warn(
                    `已知机制 ${knownName} 不应携带 name，已忽略`,
                );
            } else {
                encryptionEl.setAttribute("name", info.name);
            }
        }
        return encryptionEl;
    }

    /**
     * 返回已知机制的人类可读名称
     * @param namespace 机制命名空间
     */
    static getMechanismName(namespace: string): string | undefined {
        // 不能用直接索引：`constructor`、`__proto__` 等会命中原型链
        return Object.prototype.hasOwnProperty.call(EME.KNOWN_MECHANISMS, namespace)
            ? EME.KNOWN_MECHANISMS[namespace]
            : undefined;
    }
}
