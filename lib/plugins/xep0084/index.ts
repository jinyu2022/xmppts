import { Avatar } from "./avatar";
import { PEP } from "../xep0163/pep";
import type Connection from "@/connection";
import { XMPPError } from "@/errors";
import type { Plugin } from "../types";
import type { JID } from "@/JID";
/**
 * XEP-0084: User Avatar 插件实现
 * @see https://xmpp.org/extensions/xep-0084.html
 * @version 1.1.5 (2026-08-23)
 */
export class XEP0084 extends Avatar implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addItem(this.connection.jid.bare, XEP0084.NS.data);
        this.connection.XEP0030!.addItem(this.connection.jid.bare, XEP0084.NS.metadata);
        this.connection.registerStanzaPlugin(
            XEP0084.NS.metadata,
            XEP0084.parseMetadataEl
        );
        this.connection.registerEventPlugin("pep:avatar", {
            tagName: "message",
            matcher: (message) => {
                return message.event?.node === XEP0084.NS.metadata;
            },
        });
    }

    /**
     * 通过jid获取头像数据
     * @param jid 对方的JID
     * @param metadata 头像元数据
     * @returns 头像数据base64；无 metadata 元素返回 undefined，metadata 为空返回 null
     */
    async getAvatarData(
        jid: JID | string,
        metadata?: AvatarMetadata
    ): Promise<(AvatarMetadata & { data?: string; }) | undefined | null> {
        // NOTE: 其实不需要metadata ID也可以获取到头像数据，但是规范要求通过id获取
        if (!metadata) {
            // 先获取元数据
            const getMetaDataIq = PEP.createRetrieveItemsIq(
                jid,
                XEP0084.NS.metadata,
                1
            );
            const res = await this.connection.sendAsync(getMetaDataIq);

            if (res.getAttribute("type") === "error")
                throw new XMPPError(res, "获取头像元数据失败");

            const metadataEL = res.getElementsByTagNameNS(
                XEP0084.NS.metadata,
                "metadata"
            )[0];
            // 无 metadata 元素：对方没有头像
            if (!metadataEL) return undefined;
            const parsed = XEP0084.parseMetadataEl(metadataEL);
            // metadata 元素存在但为空（无 info）
            if (parsed.metadata === null) return null;
            metadata = parsed.metadata;
        }

        const iq = PEP.createRetrieveItemsIq(jid, XEP0084.NS.data, 1, [metadata.id]);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error")
            throw new XMPPError(res, "获取头像数据失败");

        const dataEl = res.getElementsByTagNameNS(XEP0084.NS.data, "data")[0];
        return {
            ...metadata,
            data: dataEl?.textContent ?? void 0,
        };
    }

    /**
     * 发布头像数据
     * @param img 头像数据或地址
     */
    async publishAvatarData(img: string | File) {
        const [publishDataIq, publishMetadataIq] = await XEP0084.createDataPublishIq(img);
        const dataRes = await this.connection.sendAsync(publishDataIq);
        if (dataRes.getAttribute("type") === "error")
            throw new XMPPError(dataRes, "发布头像数据失败");

        const metaRes =  await this.connection.sendAsync(publishMetadataIq);
        if (metaRes.getAttribute("type") === "error")
            throw new XMPPError(metaRes, "发布头像元数据失败");
    }
}
import type { Message } from "@/stanza";
declare module "@/connection" {
    interface SocketEventMap {
        "pep:avatar"?: Message;
    }
}
import type { AvatarMetadata } from "./avatar";

declare module "../xep0060/pubsub" {
    interface PubsubEventItem {
        /** XEP0084添加 */
        metadata?: AvatarMetadata;
    }
}
export default XEP0084;
