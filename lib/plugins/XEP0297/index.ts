import { Forward, type Forwarded } from "./forward";
import type { Plugin } from "../types";
import type { Connection } from "../../connection";
/**
 * XEP-0297: Stanza Forwarding
 * @see https://xmpp.org/extensions/xep-0297.html
 * @version 1.0 (2013-10-02)
 */
export class XEP0297 extends Forward implements Plugin {
  static readonly dependencies = ["XEP0030", "XEP0203"] as const;
  readonly connection: Connection;
  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }

  init() {
    this.connection.registerStanzaPlugin(XEP0297.NS, XEP0297.parseForwardedEl);

    this.connection.registerEventPlugin("forward", {
      tagName: "message",
      matcher: (message) => {
        return !!(message?.forwarded);
      },
    });
  }


}

declare module "../../stanza" {
  interface Message {
    /** 由插件XEP0297添加 */
    readonly forwarded?: Forwarded;
  }
}
import type { Message } from "../../stanza";
declare module "../../connection" {
  interface SocketEventMap {
    /** 由插件XEP0297添加 */
    forward: Message & { forwarded: Forwarded };
  }
}
export default XEP0297;