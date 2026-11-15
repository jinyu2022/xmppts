import { JID } from "@/JID";
import { VCardTemp } from "../xep0054/vcardTemp";
import { Iq } from "@/stanza";
import { XMPPElement } from "@/ltx/Element";
import { Avatar } from "../xep0084/avatar";

export class MUCAvatars {

    /**
     * 构造设置群头像的iq
     * @param to muc 房间 JID，传入带 resource 的地址时取裸 JID
     * @param image node下绝对路径，浏览器File对象，空表示删除头像
     * @returns iq Element
     */
    static async createSetAvatarIq(to: string | JID,image?: File | string) {
        // 头像挂在房间上，目标统一取裸 JID，避免误发给 occupant
        const room = typeof to === "string" ? new JID(to).bare : to.bare;
        // 创建基础IQ结构
        const iq = Iq.createIq("set", room);
        const vCard = XMPPElement.createElementNS(VCardTemp.NS, "vCard");
        iq.appendChild(vCard);

        // 如果没有图片，返回空vCard(删除头像)
        // @see https://xmpp.org/extensions/xep-0486.html#example-8
        if (!image){
            return iq;
        }

        const { base64Data, metadata } = await Avatar.imageParser(image);
        
        const type = XMPPElement.createElement("TYPE");
        type.textContent = metadata.type;
        const binval = XMPPElement.createElement("BINVAL");
        binval.textContent = base64Data;
        
        const photo = XMPPElement.createElement("PHOTO");
        photo.appendChild(type);
        photo.appendChild(binval);
        vCard.appendChild(photo);
        return iq;
    }

    /**
     * 构造获取群头像的iq
     * @param to muc 房间 JID，传入带 resource 的地址时取裸 JID
     */
    static createGetAvatarIq(to: string | JID) {
        // 头像挂在房间上，目标统一取裸 JID，避免误发给 occupant
        const room = typeof to === "string" ? new JID(to).bare : to.bare;
        const iq = Iq.createIq("get", room);
        const vCard = XMPPElement.createElementNS(VCardTemp.NS, "vCard");
        iq.appendChild(vCard);
        return iq;
    }
}