import { Avatar } from "../xep0084/avatar";
import { Iq } from "@/stanza";
import { XMPPElement } from "@/ltx";
import { VCardTemp } from "../xep0054/vcardTemp";
import type { JID } from "@/JID";

/**
 * XEP-0153: vCard-Based Avatars  
 * 应该只有muc还用这个，个人头像应该用XEP-0084
 * @see https://xmpp.org/extensions/xep-0153.html
 * @version 1.1.1 (2024-06-10)
 */
export class XEP0153 {
    static readonly NS = "vcard-temp:x:update" as const;

    /**
     * 构造设置头像的iq
     * @param to 目标jid
     * @param image node下绝对路径，浏览器File对象，空表示删除头像
     * @returns iq XMPPElement
     */
    static async createSetVCardAvatarIq(
        to: string | JID,
        image?: File | string
    ) {
        const iq = Iq.createIq("set", to);
        const vCard = XMPPElement.createElementNS(VCardTemp.NS, "vCard");
        iq.appendChild(vCard);

        if (!image){
            return iq;
        }
        const { base64Data, metadata } = await Avatar.imageParser(image);
        const photo = XMPPElement.createElement("PHOTO");
        vCard.appendChild(photo);
        const type = XMPPElement.createElement("TYPE");
        type.textContent = metadata.type;
        const binval = XMPPElement.createElement("BINVAL");
        binval.textContent = base64Data;
        photo.appendChild(type);
        photo.appendChild(binval);
        return iq;
    }

    static createUpdatePresence(to: string | JID, avatarHash: string) {
        if (typeof to !== "string") to = to.toString();
        return `<presence to='${to}'><x xmlns='${XEP0153.NS}'><photo>${avatarHash}</photo></x></presence>`;
    }

    static parseVCardAvatar(stanza: XMPPElement): VCardPhoto {
        const photo = stanza.getElementsByTagName("PHOTO")[0];
        if (!photo)
            throw new Error(`没有photo标签: ${stanza.toXMLString()}`);
        if (photo.namespaceURI !== VCardTemp.NS)
            throw new Error(`不是vcard-temp命名空间: ${stanza.toXMLString()}`);
        const binval = photo.getElementsByTagName("BINVAL")[0]?.textContent ?? "";
        const type = photo.getElementsByTagName("TYPE")[0]?.textContent as VCardPhoto["type"];
        return {binval, type};
    }
}

export interface VCardPhoto {
    type: "image/gif" | "image/png" | "image/jpeg"; // 图片类型
    binval: string; // base64 编码的图片数据
}

declare module "../../stanza" {
    interface Iq {
        vCard?: {
            photo?: VCardPhoto;
        };
    }
}
