import type { JID } from "@/JID";
import { MUCAvatars } from "./MUCAvatars";
import type { Plugin } from "../types";
import type Connection from "@/connection";
import { XMPPError } from "@/errors";
import { XEP0153 } from "../xep0153";
/**
 * XEP-0486: MUC Avatars
 * @see https://xmpp.org/extensions/xep-0486.html
 * @version 0.1.0 (2024-03-10)
 */
export class XEP0486 extends MUCAvatars implements Plugin {

    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        // 忽略
    }
    /**
     * 
     * @param to muc jid
     * @param image 绝对路径或者File对象，空表示删除头像
     */
    async setAvatar(to: string | JID, image?: File | string) {
        const iq = await XEP0486.createSetAvatarIq(to, image)
        const res =  await this.connection.sendAsync(iq);
        if (res.getAttribute('type') === 'error') {
            throw new XMPPError(res, `设置 ${to.toString()} 的muc头像失败`);
        }
        return res;
    }

    /**
     * 获取muc头像
     * @param to muc jid
     */
    async getAvatar(to: string | JID) {
        const iq = XEP0486.createGetAvatarIq(to);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute('type') === 'error') {
            throw new XMPPError(res, `获取 ${to.toString()} 的muc头像失败`);
        }
        return XEP0153.parseVCardAvatar(res);
    }
} 

export default XEP0486;