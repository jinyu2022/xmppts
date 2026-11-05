import type { Connection } from "../../connection";
import type { Plugin } from "../types";
import { Delay } from "./delay";

/**
 * XEP-0203：Delayed Delivery
 * @see https://xmpp.org/extensions/xep-0203.html
 * @version 2.0 (2009-09-15)
 */
export class XEP0203 extends Delay implements Plugin {
    readonly connection: Connection;
    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(XEP0203.NS, XEP0203.parseDelayEl);
    }
}

export default XEP0203;

declare module "../../stanza" {
    interface Message {
        /** xep0203 */
        delay?: {
            stamp: Date;
            /** 延迟信息添加方；§2 为可选属性，缺失时为 undefined */
            from?: string;
            reason?: string;
        };
    }
}