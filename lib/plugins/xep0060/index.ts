import type { Connection } from "@/connection";
import type { Plugin } from "../types";
import { Pubsub } from "./pubsub";

/**
 * XEP-0060: Publish-Subscribe
 *
 * 插件形态只做一件事：注册 `pubsub#errors` 的解析器，使错误响应里的附加条件
 * （§11、§17.2）出现在 `stanza.error` 上。请求构造与其余解析都是 {@link Pubsub}
 * 的静态方法，无需连接即可使用。
 * @see https://xmpp.org/extensions/xep-0060.html
 * @version 1.30.0 (2025-11-11)
 */
export class XEP0060 extends Pubsub implements Plugin {
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(Pubsub.NS.ERRORS, Pubsub.parseErrorChildEl);
    }
}

export default XEP0060;
