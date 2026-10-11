import type Connection from "@/connection";
import type { Plugin } from "../types";
import { XMPPError } from "@/errors";
import { Nickname } from "./nickname";
import logger from "@/log";
const log = logger.getLogger("XEP0172");
/**
 * XEP-0172: User Nickname
 * @see https://xmpp.org/extensions/xep-0172.html
 * @version 1.1 (2012-03-21)
 */
class XEP0172 extends Nickname implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;
    private selfNickPromise?: Promise<string | void>;
    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(XEP0172.NS, XEP0172.parseNickEl);
        this.connection.registerEventPlugin("pep:nickname", {
            tagName: "message",
            matcher: (message) => {
                return message.event?.node === XEP0172.NS;
            },
        });

        this.connection.once("session:start", async () => { });
    }

    /**
     * 检索用户昵称
     * @param jid 要检索的用户的JID
     * @returns 昵称
     * @throws {XMPPError} 如果检索失败
     */
    async retrieveNick(jid: string) {
        const iq = XEP0172.createRetrieveNickIq(jid);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error")
            throw new XMPPError(res, "获取昵称失败");
        const nickEL = res.getElementsByTagNameNS(XEP0172.NS, "nick")[0];
        return nickEL.textContent;
    }

    /**
     * 暴露获取自己昵称的方法，供其他插件调用
     */
    async getSelfNick() {
        this.selfNickPromise ??= this.retrieveNick(this.connection.jid.toString())
                .then(nick => nick)
                .catch(error => {
                    // 获取昵称失败，可能是服务器不支持，或者用户没有设置昵称，这些都不是严重错误，不抛出异常
                    log.warn("获取自己的昵称失败", error);
                });
        return this.selfNickPromise;
    }
}

import type { Message } from "@/stanza";
declare module "../../stanza" {
    interface Message {
        nick?: string;
    }

    interface Presence {
        nick?: string;
    }
}
declare module "../../connection" {
    interface SocketEventMap {
        "pep:nickname"?: Message & { nick: string; };
    }
}
export default XEP0172;
