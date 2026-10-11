import { EntityCaps } from "./entityCaps";
import type Connection from "@/connection";
import type { Plugin } from "../types";
import type { XMPPElement } from "@/ltx";
// TODO: 准备一个文件，内置部分能力与哈希值的映射

/**
 * XEP-0115: Entity Capabilities
 * @see https://xmpp.org/extensions/xep-0115.html
 * @version 1.6.0 (2022-03-08)
 */
export default class XEP0115 extends EntityCaps implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;
    private selfCaps?: XMPPElement;
    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(EntityCaps.NS);
        this.connection.registerStanzaPlugin(EntityCaps.NS, EntityCaps.parseCaps);

        // 按照规范需要在发送presence时附加自己的实体能力
        this.connection.pipeline.use("send", (ctx, next) => {
            const stanza = ctx.stanza;
            if (stanza.tagName === "presence" && this.selfCaps) {
                stanza.appendChild(this.selfCaps);
            }
            return next();
        });

        this.connection.on("presence", () => {
            // TODO: 通过ver查找文件中对应的实体能力，然后加入到discos中
        });

        this.connection.once("connect", async () => {
            const identities  = this.connection.XEP0030!.identities;
            // 要排序，所以转成数组
            const features = [...this.connection.XEP0030!.features];
            const ver = await EntityCaps.generateCapsVerification(identities, features);
            this.selfCaps = EntityCaps.createCapsElement({
                node: "http://lekexmpp.chat",
                ver,
                hash: "sha-1"
            });
        })
    }
}