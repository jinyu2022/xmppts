import { EntityCaps } from "./entityCaps";
import type Connection from "@/connection";
import type { Plugin } from "../types";
import type { XMPPElement } from "@/ltx";
import logger from "@/log";
// TODO: 准备一个文件，内置部分能力与哈希值的映射
const log = logger.getLogger("XEP0115");

/** XEP-0115 插件配置 */
export interface XEP0115Options {
    /**
     * 实体能力节点标识（§4.1）
     *
     * 对端用它拼成 `node#ver` 向本端查询 disco#info，应在软件的各个版本间保持稳定，
     * 且不能包含 `#`。
     */
    node?: string;
}

/**
 * XEP-0115: Entity Capabilities
 * @see https://xmpp.org/extensions/xep-0115.html
 * @version 1.6.0 (2022-03-08)
 */
export default class XEP0115 extends EntityCaps implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;
    /** 本端的实体能力节点标识 */
    private readonly node: string;
    private selfCaps?: XMPPElement;
    constructor(connection: Connection, options?: XEP0115Options) {
        super();
        this.connection = connection;
        this.node = options?.node ?? "http://xmppts.chat";
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
    }

    onSessionBound(): void {
        // 新会话：能力集合可能已变化，清空旧结果后重算；presence 发送时附加最新结果
        this.selfCaps = undefined;
        const identities = this.connection.XEP0030!.identities;
        // 要排序，所以转成数组
        const features = [...this.connection.XEP0030!.features];
        void EntityCaps.generateCapsVerification(identities, features)
            .then((ver) => {
                this.selfCaps = EntityCaps.createCapsElement({
                    node: this.node,
                    ver,
                    hash: "sha-1"
                });
            })
            .catch((error: unknown) => log.warn("计算自身能力哈希失败", error));
    }
}