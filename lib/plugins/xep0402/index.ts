import { Bookmarks } from "./bookmarks";
import logger from "@/log";
import type Connection from "@/connection";
import type { Plugin } from "../types";
import { XMPPError } from "@/errors";
import { Pubsub, type PubsubEvent } from "../xep0060/pubsub";
import type { Conference } from "./bookmarks";
const log = logger.getLogger("XEP0402");
/**
 * XEP-0402: PEP Native Bookmarks
 * 加载此插件后会自动加入频道
 * @see https://xmpp.org/extensions/xep-0402.html
 * @version 1.2.0 (2024-08-15)
 */
export default class XEP0402 extends Bookmarks implements Plugin {
    // 仅在需要加入群聊时需要求 XEP0045，本插件本事不依赖 XEP0045，故不将 XEP0045 列为必选依赖
    // XEP0060 只为解析错误里的 pubsub#errors 附加条件，便于调用方识别节点配置问题
    static readonly dependencies = ["XEP0030", "XEP0163", "XEP0060"] as const;
    static readonly NS_NOTIFY = "urn:xmpp:bookmarks:1+notify";
    readonly connection: Connection;
    /** 书签列表 */
    bookmarks: Conference[] = [];
    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(XEP0402.NS_NOTIFY);
        this.connection.registerStanzaPlugin(
            XEP0402.NS,
            XEP0402.parseConferenceEl,
        );
        this.connection.registerEventPlugin("bookmark:update", {
            tagName: "message",
            matcher: (message) =>
                message.event?.node === Bookmarks.NS &&
                message.event?.item?.conference != null &&
                // PEP 协议要求通知必须是来自本账号的 bare JID（XEP-0163 §4.3.1）
                message.from.bare === this.connection.jid.bare,
        });

        this.connection.registerEventPlugin("bookmark:delete", {
            tagName: "message",
            matcher: (message) =>
                message.event?.node === Bookmarks.NS && 
                message.event?.retracts != null && 
                // PEP 协议要求通知必须是来自本账号的 bare JID（XEP-0163 §4.3.1）
                message.from.bare === this.connection.jid.bare,
        });

        // 其他客户端对书签的增删改经 PEP 通知同步到本地状态（XEP-0402 §4）
        this.connection.on("bookmark:update", (message) => {
            const { id, conference } = message.event.item;
            this.upsertBookmark({ ...conference, jid: id });
        });
        this.connection.on("bookmark:delete", (message) => {
            const { retracts } = message.event;
            this.bookmarks = this.bookmarks.filter((b) => !retracts.includes(b.jid));
        });

        // 首次会话建立后检索书签并装载公开状态；加载了 XEP0045 时才自动加入 autojoin 的房间
        this.connection.once("session:start", async () => {
            try {
                this.bookmarks = await this.retrieveBookmarks();
            } catch (error) {
                log.error("检索书签失败", error);
                return;
            }
            if (!this.connection.XEP0045) return;
            const autojoinRooms = this.bookmarks.filter((b) => b.autojoin);

            // 各房间缺失昵称时回退到同一份用户昵称，只需查询一次
            const fallbackNick = autojoinRooms.some((room) => !room.nick)
                ? await this.connection.XEP0172?.getSelfNick()
                : undefined;
            for (const roomJid of autojoinRooms) {
                const nick = roomJid.nick ?? fallbackNick ?? this.connection.jid.local;
                try {
                    // 书签里的密码是 §7.2 进入密码房间所需的 `<password/>`
                    await this.connection.XEP0045.join(
                        roomJid.jid,
                        nick,
                        roomJid.password ? { password: roomJid.password } : undefined,
                    );
                } catch (error) {
                    log.warn(`加入会议 ${roomJid.jid} 失败`, error);
                }
            }
        });
    }

    /**
     * 按房间 JID 更新或追加书签，供通知同步与本地增删改复用
     * @param conference 书签内容，`jid` 为房间地址（即 item id）
     */
    private upsertBookmark(conference: Conference) {
        const index = this.bookmarks.findIndex((b) => b.jid === conference.jid);
        if (index === -1) this.bookmarks.push(conference);
        else this.bookmarks[index] = conference;
    }

    /**
     * 检索所有书签
     * @returns 书签列表
     * @throws {XMPPError} 检索书签失败
     */
    async retrieveBookmarks() {
        const iq = Bookmarks.createRetrieveBookmarksIq(this.connection.jid.bare);
        const resIq = await this.connection.sendAsync(iq);
        if (resIq.getAttribute("type") === "error") {
            throw new XMPPError(resIq, "检索书签失败");
        }
        const bookmarks = Bookmarks.parseBookmarksIq(resIq);
        return bookmarks;
    }

    /**
     * 添加书签。发布时携带 XEP-0402 §3.3 规定的 publish-options，
     * 节点配置与前提条件不符时服务端返回 `precondition-not-met`，由调用方决定是否 `configureBookmarkNode()` 后重试
     * @throws {XMPPError} 添加书签失败
     */
    async addBookmark(conference: Conference & { jid: string; }) {
        const iq = XEP0402.createAddBookmarkIq(conference, XEP0402.createPublishOptionsEl());
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "添加书签失败");
        }
        this.upsertBookmark(conference);
    }

    /**
     * 编辑书签意味着将具有相同书签 JID 作为 id 的项目重新发布
     * @throws {XMPPError} 编辑书签失败
     */
    async editBookmark(conference: Conference & { jid: string; }) {
        const iq = XEP0402.createAddBookmarkIq(conference, XEP0402.createPublishOptionsEl());
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "编辑书签失败");
        }
        this.upsertBookmark(conference);
    }

    /**
     * 按书签节点应有的配置提交 `#node_config`（白名单访问、持久化，XEP-0402 §3.3 Example 6）。
     * 供调用方在服务端不支持 publish-options（XEP-0402 §8 要求先配置再发布），
     * 或发布返回 `precondition-not-met` 时自行决定是否调用；本方法不会自动重试发布
     * @throws {XMPPError} 配置节点失败
     */
    async configureBookmarkNode() {
        const iq = Pubsub.createConfigureNodeIq(
            this.connection.jid.bare,
            Bookmarks.NS,
            Bookmarks.createNodeConfigForm(),
        );
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "配置书签节点失败");
        }
    }

    /**
     * 删除书签意味着撤回由书签的 JID 标识的现有项目
     */
    async deleteBookmark(jid: string) {
        const retract = XEP0402.createDeleteBookmarkIq(jid);
        const res = await this.connection.sendAsync(retract);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "删除书签失败");
        }
        this.bookmarks = this.bookmarks.filter((b) => b.jid !== jid);
    }
}

declare module "@/plugins/xep0060/pubsub" {
    export interface PubsubEventItem {
        /** XEP0402：conference 的解析结果；房间 JID 在 `<item id>` 上，不在 conference 内 */
        conference?: Omit<Conference, "jid">;
    }
}

import type { Message } from "@/stanza";
declare module "@/connection" {
    interface SocketEventMap {
        /** XEP0402：匹配器已保证来自本账号、node 为书签节点、首个 item 带 item id 与 conference */
        "bookmark:update": Message & {
            event: PubsubEvent & {
                node: typeof Bookmarks.NS;
                item: { id: string; conference: Omit<Conference, "jid"> };
            };
        };
        /** XEP0402：匹配器已保证来自本账号、node 为书签节点、retracts 非空 */
        "bookmark:delete": Message & {
            event: PubsubEvent & {
                node: typeof Bookmarks.NS;
                retracts: string[];
            };
        };
    }
}
