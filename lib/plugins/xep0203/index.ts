import type { Connection } from "../../connection";
import type { Plugin } from "../types";
import { Delay } from "./delay";

/**
 * XEP-0203：Delayed Delivery
 * @see https://xmpp.org/extensions/xep-0203.html
 * @version 2.0 (2009-09-15)
 */
export class XEP0203 extends Delay implements Plugin {
    private readonly connection: Connection;
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
        /**
         * xep0203 延迟投递信息（`<delay/>`，§2）
         * - `stamp`：原始发送时间
         * - `from`：延迟信息添加方，可选，缺失时为 undefined
         * - `reason`：延迟原因
         */
        delay?: { stamp: Date; from?: string; reason?: string };
    }

    interface Presence {
        /** xep0203：§2 允许 presence 携带 `<delay/>`，如离线前的最后一次 available */
        delay?: { stamp: Date; from?: string; reason?: string };
    }
}