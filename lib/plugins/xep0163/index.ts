import type Connection from "@/connection";
import type { Plugin } from "../types";
import {PEP} from "./pep";
import { Pubsub } from "@/plugins/xep0060/pubsub";

/**
 * XEP-0163: Personal Eventing Protocol 个人事件协议
 * @see https://xmpp.org/extensions/xep-0163.html
 * @version 1.2.2 (2022-02-16)
 */
export class XEP0163 extends PEP implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(Pubsub.NS.EVENT, Pubsub.parseEventEl);
        // this.connection.XEP0030!.getServerIdentities().then((identities) => {
        //     if (
        //         !identities.some(
        //             (identity) => identity.type === "pep" && identity.category === "pubsub"
        //         )
        //     ) {
        //         this.connection.deregisterPlugin('XEP0163')
        //         console.error("服务器不支持XEP-0163");
        //     }
        // });
    }
}

export default XEP0163;