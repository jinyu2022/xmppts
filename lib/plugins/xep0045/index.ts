import type { Connection } from "@/connection";
import { Plugin } from "../types";
import { MUC, JoinOptions, MUCStatusCode } from "./muc";
import { XMPPError, TimeoutError } from "@/errors";
import { XEP0004 } from "../xep0004";
import { JID } from "@/JID";
import type { DataForm } from "../xep0004/form";
import type { MUCUserPres, MUCUser, MUCItem } from "./typing";
import logger from "@/log";
const log = logger.getLogger("XEP0045");
/**
 * XEP-0045: Multi-User Chat
 * @see https://xmpp.org/extensions/xep-0045.html
 * @version 1.35.5 (2026-05-03)
 */
export class XEP0045 extends MUC implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;

    /** 存储已加入的房间信息，键是房间的jid */
    readonly rooms: Map<string,
        {
            /** 自己的昵称 */
            nick: string;
            /** 键是用户的roomjid */
            occupants: Map<string, MUCUser>;
            /** 加入时使用的房间密码（如有），供重入复用 */
            password?: string;
        }
    > = new Map();

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        this.connection.XEP0030!.addFeature(XEP0045.NS.BASE);

        this.connection.registerStanzaPlugin(
            XEP0045.NS.USER,
            XEP0045.parsePresUser
        );
        this.connection.registerEventPlugin("muc:join", {
            tagName: "presence",
            matcher: (pers: Presence) => {
                // 首次出现的住户（含本人、改新名）；已在 occupants 中的是状态更新（§7.7）
                return Boolean(
                    !pers.type &&
                    pers.muc?.item &&
                    !this.rooms.get(pers.from.bare)?.occupants.has(pers.from.full)
                );
            },
        });
        this.connection.registerEventPlugin("muc:leave", {
            tagName: "presence",
            matcher: (pers: Presence) => {
                // 已记录住户的 unavailable（含本人、改旧名、被踢/禁；§7.6/§7.14）
                return Boolean(
                    pers.type === "unavailable" &&
                    pers.muc?.item &&
                    this.rooms.get(pers.from.bare)?.occupants.has(pers.from.full)
                );
            },
        });
        this.connection.registerEventPlugin("muc:groupchat", {
            tagName: "message",
            matcher: (msg) => {
                return Boolean(msg.type === "groupchat" && msg.body);
            },
        });
        this.connection.registerEventPlugin("muc:subject", {
            tagName: "message",
            matcher: (msg) => {
                return Boolean(msg.type === "groupchat" && msg.subject != null && msg.body == null);
            },
        });
        this.connection.registerEventPlugin("muc:kick", {
            tagName: "presence",
            matcher: (pers) => {
                // 307 会广播给全房间，本人被踢时 statuses 还含 110（§8.2）
                return Boolean(
                    pers.type === "unavailable" &&
                    pers.muc?.item &&
                    pers.muc.statuses?.includes(MUCStatusCode.Kicked)
                );
            },
        });
        this.connection.registerEventPlugin("muc:ban", {
            tagName: "presence",
            matcher: (pers) => {
                // 301 会广播给全房间，本人被封禁时 statuses 还含 110（§9.1）
                return Boolean(
                    pers.type === "unavailable" &&
                    pers.muc?.item &&
                    pers.muc.statuses?.includes(MUCStatusCode.Banned)
                );
            },
        });
        this.connection.registerEventPlugin("muc:destroy", {
            tagName: "presence",
            matcher: (pers) => {
                const muc = pers.muc;
                return Boolean(muc && "destroy" in muc);
            },
        });
        this.connection.registerEventPlugin("muc:mediated-invite", {
            tagName: "message",
            matcher: (msg) => Boolean(msg.muc && "invites" in msg.muc),
        });
        this.connection.registerEventPlugin("muc:decline", {
            tagName: "message",
            matcher: (msg) => Boolean(msg.muc && "decline" in msg.muc),
        });
        this.connection.registerEventPlugin("muc:voice-request", {
            tagName: "message",
            matcher: (msg) => {
                // XEP-0045 §8.6：审批表单为 type=form 且 FORM_TYPE 为 muc#request
                const formEl = msg.xml.getElementsByTagNameNS(XEP0004.NS, "x")[0];
                if (!formEl) return false;
                const form = XEP0004.parseFormEl(formEl).form;
                return (
                    form.type === "form" &&
                    form.fields.some(
                        (field) =>
                            field.var === "FORM_TYPE" &&
                            field.values[0] === "http://jabber.org/protocol/muc#request"
                    )
                );
            },
        });

        this.connection.on("presence", (pres) => {
            if (!pres.muc?.item) return;
            // XMPP error presences 不代表房间状态变化，跳过
            if (pres.type === "error") return;

            const room = pres.from.bare;
            const userJid = pres.from.full;
            const user = {
                nick: pres.from.resource!,
                ...pres.muc.item,
            };
            if (pres.type === "unavailable") {
                if (pres.muc.statuses?.includes(MUCStatusCode.SelfPresence)) {
                    // 昵称变更（含 303）：保留房间，仅移除旧昵称
                    if (pres.muc.statuses.includes(MUCStatusCode.NewNick)) {
                        this.rooms.get(room)?.occupants.delete(userJid);
                    } else {
                        // 真正离开，删除房间
                        this.rooms.delete(room);
                    }
                } else {
                    this.rooms.get(room)?.occupants.delete(userJid);
                    // 房间被销毁（§10.9）：连同房间条目一起清理
                    if ("destroy" in pres.muc) this.rooms.delete(room);
                }
            } else {
                // 确保房间存在（昵称变更后旧 nick 的 unavailable 已保留房间）
                if (!this.rooms.has(room)) {
                    this.rooms.set(room, {
                        nick: pres.from.resource!,
                        occupants: new Map(),
                    });
                }
                // 收到自身 available presence 时更新存储的昵称
                if (pres.muc.statuses?.includes(MUCStatusCode.SelfPresence)) {
                    this.rooms.get(room)!.nick = pres.from.resource!;
                }
                this.rooms.get(room)?.occupants.set(userJid, user);
            }
        });
    }

    /** 归一化房间 JID（bare 键）并确认已加入，返回该 JID */
    private requireJoined(room: string | JID) {
        const roomJid = typeof room === "string" ? new JID(room) : room;
        if (!this.rooms.has(roomJid.bare)) {
            throw new Error(`未加入房间${roomJid.bare}`);
        }
        return roomJid;
    }

    /**
     * 加入MUC
     * @param room 要加入的房间
     * @param nick 昵称
     * @param options 加入选项，全部可选
     *   - maxchars 最大字符数
     *   - maxstanzas 最大消息数
     *   - seconds 最大秒数
     *   - since 从某个时间开始
     *   - password 房间密码
     * @param timeout 两个pre节之间的超时时间，默认为5分钟
     * @returns 加入房间的响应节
     */
    join(
        room: string | JID,
        nick: string,
        options?: JoinOptions,
        timeout = 300_000
    ) {
        room = typeof room === "string" ? new JID(room) : room;
        const pres = XEP0045.createJoinPres(room, nick, options);
        /**
         * @see https://xmpp.org/extensions/xep-0045.html#enter-pres
         * 加入成功后，服务端会返回其他居住者的presence，自己的presence会在其他居住者的presence发送完成后才返回
         * 自己的响应presence的id和加入请求的presence的id可能是一样的（不保证）
         * 自己的响应presence的status code中会包含110，表示self-presence
         * 加入房间的presence的type为null，错误时为error
         * 收到自己的presence代表加入房间成功，收到其他居住者的presence代表其他居住者已知晓自己加入了房间
         */

        // 不使用 sendAsync，因为 presence 的 id 回显不保证
        // 根据 XEP-0045 §7.2.2，成功标志是收到 status code 110 的 self-presence
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>;

            const resetTimer = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    cleanup();
                    this.rooms.delete(room.bare);
                    reject(new TimeoutError("加入房间超时：收到首个 presence 后未能在超时时间内收到 self-presence"));
                }, timeout);
                timer.unref?.();
            };

            const handler = (presence: Presence) => {
                if (presence.from.bare !== room.bare) return;

                // 错误响应
                if (presence.type === "error") {
                    cleanup();
                    this.rooms.delete(room.bare);
                    reject(new XMPPError(presence.xml, "加入房间失败"));
                    return;
                }
                // 避免出现其他用户加入先触发，房间不存在的情况
                // init() 中注册的全局 presence 处理器会通过 rooms.get(room) 添加用户
                if (!this.rooms.has(presence.from.bare)) {
                    this.rooms.set(presence.from.bare, {
                        nick,
                        occupants: new Map(),
                    });
                }

                log.debug(`收到房间用户 ${presence.from.full} 的presence`);

                // 后续每个 presence 都重置超时
                resetTimer();

                // self-presence → 加入成功
                if (presence.muc?.statuses?.includes(MUCStatusCode.SelfPresence)) {
                    cleanup();
                    log.debug("加入房间成功");
                    // 仅加入成功才记录密码供重入复用（房间条目已由上方保证存在）
                    if (options?.password) this.rooms.get(room.bare)!.password = options.password;
                    resolve(presence.xml);
                }
            };
            const cleanup = () => {
                this.connection.off("presence", handler);
                clearTimeout(timer);
            };
            // 使用 prependListener 确保在 init() 中注册的全局 presence 处理器之前触发
            this.connection.prependListener("presence", handler);
            this.connection.send(pres);
            resetTimer();
        });
    }

    async leave(to: string | JID, reason?: string) {
        // 规范化为 bare JID 用于房间查找
        const roomJid = typeof to === "string" ? new JID(to) : to;
        const bare = roomJid.bare;
        const room = this.rooms.get(bare);
        if (!room) throw new Error(`未加入房间${bare}`);

        // 构造完整的 occupant JID: room/nick
        const fullJid = `${bare}/${room.nick}`;
        const pres = XEP0045.createLeavePres(fullJid, reason);

        // 不使用 sendAsync，因为 presence 的 id 回显不保证
        // 成功标志是收到 status code 110 的 self-presence，type=unavailable
        return new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new TimeoutError("离开房间超时"));
            }, 10_000);
            timeoutId.unref?.();

            const handler = (presence: Presence) => {
                if (presence.from.bare !== bare) return;

                if (presence.type === "error") {
                    cleanup();
                    reject(new XMPPError(presence.xml, "离开房间失败"));
                    return;
                }

                // self-presence → 离开成功
                if (presence.type === "unavailable" &&
                    presence.muc?.statuses?.includes(MUCStatusCode.SelfPresence)) {
                    cleanup();
                    log.debug("离开房间成功");
                    resolve();
                }
            };

            const cleanup = () => {
                this.connection.off("presence", handler);
                clearTimeout(timeoutId);
            };

            this.connection.on("presence", handler);
            this.connection.send(pres);
        });
    }

    setNick(room: string | JID, nick: string) {
        const roomJid = this.requireJoined(room);
        const pres = XEP0045.createSetNickPres(roomJid, nick);
        const id = pres.getAttribute("id")!;
        const selfRoomJid = `${roomJid.bare}/${this.rooms.get(roomJid.bare)!.nick}`;
        return new Promise<Presence>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new TimeoutError("设置昵称超时"));
            }, 10_000);
            timeoutId.unref?.();
            const cleanup = () => {
                this.connection.off("presence", handler);
                clearTimeout(timeoutId);
            };

            const handler = (presence: Presence) => {
                // 错误响应：服务端回显相同 id 且 type=error
                if (presence.id === id && presence.type === "error") {
                    cleanup();
                    reject(new XMPPError(presence.xml, "设置昵称失败"));
                    return;
                }

                // 成功响应：来自自身旧 room JID，且包含 110 self-presence
                // 房间状态（nick、occupants）由全局 presence handler 管理，这里只确认成功
                if (presence.from.full === selfRoomJid &&
                    presence.muc?.statuses?.includes(MUCStatusCode.SelfPresence)) {
                    cleanup();
                    log.debug("设置昵称成功");
                    resolve(presence);
                }
            };
            this.connection.on("presence", handler);
            this.connection.send(pres);
        });
    }


    /**
     * 请求发言权
     * @param room 房间jid
     */
    requestVoice(room: string | JID) {
        this.requireJoined(room);
        const pres = XEP0045.createRequestVoiceMsg(room);
        this.connection.send(pres);
    }

    /**
     * 设置房间主题
     * @param room 房间jid
     * @param subject 主题
     * @link https://xmpp.org/extensions/xep-0045.html#enter-subject
     */
    async setSubject(room: string | JID, subject: string) {
        this.requireJoined(room);
        const msg = XEP0045.createSetSubjectMsg(room, subject);
        const res = await this.connection.sendAsync(msg);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "设置主题失败");
        } else if (res.getAttribute("type") === "groupchat") {
            log.debug("设置主题成功");
        }
    }

    /**
     * 踢出
     * @param room 房间jid
     * @param nick 室内昵称
     * @param reason 原因
     */
    async kick(room: string | JID, nick: string, reason?: string) {
        this.requireJoined(room);
        const iq = XEP0045.createSetRoleIq(room, nick, "none", reason);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "踢人失败");
        } else if (res.getAttribute("type") === "result") {
            log.debug("踢人成功");
        }

    }

    /**
     * 封禁用户，将归属改为 outcast
     * @param room 房间id
     * @param jid 住户的jid
     * @param reason 原因
     */
    async ban(room: string | JID, jid: string | JID, reason?: string) {
        this.requireJoined(room);
        // §9.1：归属基于 bare JID 操作
        const target = typeof jid === "string" ? new JID(jid).bare : jid.bare;
        const iq = XEP0045.createSetAffiliationIq(room, target, "outcast", reason);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "禁言失败");
        } else if (res.getAttribute("type") === "result") {
            log.debug("禁言成功");
        }

    }

    async getRoomConfig(room: string | JID) {
        this.requireJoined(room);
        const iq = XEP0045.createGetRoomConfigIq(room);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "获取房间配置失败");
        }
        const formEl = res.getElementsByTagNameNS(XEP0004.NS, "x")[0];
        const form = XEP0004.parseFormEl(formEl).form;
        return form;
    }

    async setRoomConfig(room: string | JID, dataForm: DataForm) {
        this.requireJoined(room);
        const iq = XEP0045.createSetRoomConfigIq(room, dataForm);
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "设置房间配置失败");
        }
        return res;
    }

    /**
     * 创建私人群聊
     */
    async createPrivateRoom(room: string, roomName: string) {
        // 首先请求配置表单
        const form = await this.getRoomConfig(room);
        form.type = "submit";
        const fields = form.fields;
        for (const field of fields) {
            // 去除options
            delete field.options;
            switch (field.var) {
                // 设置房间名
                case "muc#roomconfig_roomname":
                    field.values = [roomName];
                    break;
                // 仅限成员
                case "muc#roomconfig_membersonly":
                    field.values = ["1"];
                    break;
                // 开启审核
                case "muc#roomconfig_moderatedroom":
                    field.values = ["1"];
                    break;
                // 不允许公开搜索
                case "muc#roomconfig_publicroom":
                    field.values = ["0"];
                    break;
                // 公开用户的JID
                case "muc#roomconfig_whois":
                    field.values = ["anyone"];
                    break;
            }
        }
        const res = await this.setRoomConfig(room, form);
        if (res.getAttribute("type") === "result") {
            log.debug("创建房间成功");
        } else if (res.getAttribute("type") === "error") {
            throw new Error(`创建房间失败: ${res.toXMLString()}`);
        } else {
            throw new Error(`未知的stanza类型: ${res.toXMLString()}`);
        }
    }

    /**
     * 创建公开频道
     * @param room 房间jid
     * @param roomName 房间名
     */
    async createPublicRoom(room: string, roomName: string) {
        // 首先请求配置表单
        const form = await this.getRoomConfig(room);
        form.type = "submit";
        const fields = form.fields;
        for (const field of fields) {
            // 去除options
            delete field.options;
            switch (field.var) {
                // 设置房间名
                case "muc#roomconfig_roomname":
                    field.values = [roomName];
                    break;
                // 开启公开搜索
                case "muc#roomconfig_publicroom":
                    field.values = ["1"];
                    break;
                // 公开用户的JID
                case "muc#roomconfig_whois":
                    field.values = ["anyone"];
                    break;
            }
        }
        const res = await this.setRoomConfig(room, form);
        if (res.getAttribute("type") === "result") {
            log.debug("创建房间成功");
        } else if (res.getAttribute("type") === "error") {
            throw new Error(`创建房间失败: ${res.toXMLString()}`);
        } else {
            throw new Error(`未知的stanza类型: ${res.toXMLString()}`);
        }
    }
}

import type { Message, Presence } from "@/stanza";

declare module "@/stanza" {
    interface Presence {
        muc?: MUCUserPres;
    }
    /** 邀请/拒绝消息同样携带 muc#user 扩展 */
    interface Message {
        muc?: MUCUserPres;
    }
}

declare module "@/connection" {
    interface SocketEventMap {
        /** 有住户加入房间（含本人；本人 presence 的 statuses 含 110） */
        "muc:join": Presence & { type: null; muc: { item: MUCItem; statuses?: string[] } };
        /** 有住户离开房间（含本人；改名产生的旧昵称 unavailable 也算，§7.6） */
        "muc:leave": Presence & { type: "unavailable"; muc: { item: MUCItem; statuses?: string[] } };
        /** 接受到来自群聊的消息时触发（type="groupchat", body 为消息内容） */
        "muc:groupchat": Message & { type: "groupchat"; body: string };
        /** 收到群聊主题时触发（type="groupchat", subject 必存在, body 为 null） */
        "muc:subject": Message & { type: "groupchat"; subject: string; body: null };
        /** 收到房间转发的邀请消息（§7.8.2, message 携带 <x><invite/>） */
        "muc:mediated-invite": Message & { muc: MUCUserPres<"invite"> };
        // "muc:direct-invite"?: Presence;
        /** 收到房间转发的拒绝邀请消息（§7.8.3, message 携带 <x><decline/>） */
        "muc:decline": Message & { muc: MUCUserPres<"decline"> };
        /** 房间被销毁（muc 中 destroy 必存在） */
        "muc:destroy": Presence & { muc: MUCUserPres<"destroy"> };
        /** 有住户被踢出房间（307；本人被踢时 statuses 还含 110，§8.2） */
        "muc:kick": Presence & { type: "unavailable"; muc: { item: MUCItem; statuses: string[] } };
        /** 有住户被封禁（301；本人被封禁时 statuses 还含 110，§9.1） */
        "muc:ban": Presence & { type: "unavailable"; muc: { item: MUCItem; statuses: string[] } };
        /** 收到发言权审批表单消息（§8.6, FORM_TYPE 为 muc#request 的 data form） */
        "muc:voice-request": Message;
    }
}

export default XEP0045;
