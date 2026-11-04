import type Connection from "@/connection";
import type { Message } from "@/stanza";
import type { PubsubEvent } from "../xep0060/pubsub";
import type { Plugin } from "../types";
import { XMPPError } from "@/errors";
import { Nickname } from "./nickname";
/**
 * XEP-0172: User Nickname
 * @see https://xmpp.org/extensions/xep-0172.html
 * @version 1.1 (2012-03-21)
 */
class XEP0172 extends Nickname implements Plugin {
    static readonly dependencies = ["XEP0030", "XEP0163"] as const;
    readonly connection: Connection;
    private selfNickPromise?: Promise<string | undefined>;
    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.registerStanzaPlugin(XEP0172.NS, XEP0172.parseNickEl);
        this.connection.registerEventPlugin("pep:nickname", {
            tagName: "message",
            matcher: (message) => {
                // 只认 PEP 通知（§4.2 Example 6）；直接挂在 <message/> 上的 <nick/> 不是 PEP 事件
                if (message.event?.node !== XEP0172.NS) return false;
                const nick = message.event.item?.nick;
                if (typeof nick !== "string") return false;
                return true;
            },
        });
    }

    /**
     * 检索用户昵称
     * @param jid 要检索的用户的JID
     * @returns 昵称；用户未设置时为 undefined
     * @throws {XMPPError} 如果检索失败
     */
    async retrieveNick(jid: string): Promise<string | undefined> {
        const iq = XEP0172.createRetrieveNickIq(jid);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error")
            throw new XMPPError(res, "获取昵称失败");
        // 空 <nick/> 表示已清除昵称，与没有 <nick/> 一样视为未设置
        const nickEl = res.getElementsByTagNameNS(XEP0172.NS, "nick")[0];
        return nickEl?.textContent || undefined;
    }

    /**
     * 暴露获取自己昵称的方法，供其他插件调用
     * 未设置昵称时返回 undefined；查询失败时抛出错误，失败结果不缓存
     */
    async getSelfNick(): Promise<string | undefined> {
        this.selfNickPromise ??= this.retrieveNick(this.connection.jid.toString())
                .catch(error => {
                    // 失败不缓存，下次调用会重试；错误原样交给调用方
                    this.selfNickPromise = undefined;
                    throw error;
                });
        return this.selfNickPromise;
    }
}

declare module "../xep0060/pubsub" {
    export interface PubsubEventItem {
        /** XEP-0172：昵称载荷元素（`<item/>` 内的 `<nick/>`）解析后的文本 */
        nick?: string;
    }
}

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
        "pep:nickname"?: Message & {
            event: PubsubEvent & {
                node: typeof XEP0172.NS;
                item: { nick: string };
            };
        };
    }
}
export default XEP0172;
