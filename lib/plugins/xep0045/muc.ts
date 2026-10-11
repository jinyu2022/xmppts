import { JID } from "../../JID";
import { XMPPElement } from "../../ltx/Element";
import { Form, DataForm } from "../xep0004/form";
import { Disco } from "../xep0030/disco";
import type { MUCItem, MUCUserPres } from "./typing";
import logger from "@/log";

const log = logger.getLogger("MUC");

export interface JoinOptions {
  maxchars?: number;
  maxstanzas?: number;
  seconds?: number;
  since?: Date;
  password?: string;
}

export const MUCStatusCode = {
  /** 100 - 用户的完整 JID 对所有成员可见 */
  FullJIDVisible: "100",
  /** 101 - 用户成员身份变更 (不在房间时) */
  AffiliationChanged: "101",
  /** 102 - 房间现在显示不可用成员 */
  ShowUnavailable:  "102",
  /** 103 - 房间现在不显示不可用成员 */
  HideUnavailable: "103",
  /** 104 - 发生了非隐私相关的房间配置变更 */
  ConfigChanged: "104",
  /** 110 - 此 presence 来自用户自身 */
  SelfPresence: "110",
  /** 170 - 房间日志记录已启用 */
  LoggingEnabled: "170",
  /** 171 - 房间日志记录已禁用 */
  LoggingDisabled: "171",
  /** 172 - 房间现在是非匿名的 */
  NonAnonymous: "172",
  /** 173 - 房间现在是半匿名的 */
  SemiAnonymous: "173",
  /** 174 - 房间现在是完全匿名的 */
  FullyAnonymous: "174",
  /** 201 - 已创建一个新房间 */
  Created: "201",
  /** 210 - 用户的室内昵称已被分配或修改 */
  NickAssigned: "210",
  /** 301 - 用户已被禁止进入该房间 */
  Banned: "301",
  /** 303 - 新房间昵称 */
  NewNick: "303",
  /** 307 - 用户已被踢出房间 */
  Kicked: "307",
  /** 321 - 由于成员身份变更，用户被移除 */
  AffiliationRemoved: "321",
  /** 322 - 由于房间改为仅限成员，用户被移除 */
  MembersOnlyRemoved: "322",
  /** 332 - 由于系统关闭，用户被移除 */
  SystemShutdownRemoved: "332",
} as const;

export class MUC {
  static readonly NS = {
    BASE: "http://jabber.org/protocol/muc",
    USER: "http://jabber.org/protocol/muc#user",
    ADMIN: "http://jabber.org/protocol/muc#admin",
    OWNER: "http://jabber.org/protocol/muc#owner",
  } as const;

  static readonly ROLE = [
    "none",
    "visitor",
    "participant",
    "moderator",
  ] as const;
  static readonly AFFILIATION = [
    "none",
    "outcast",
    "member",
    "admin",
    "owner",
  ] as const;

  /**
   * 加入MUC
   * @param room 要加入的房间
   * @param nick 昵称
   * @param options 加入选项，全部可选
   *   - maxchars 最大字符数，不接受则设置为0
   *   - maxstanzas 最大消息数
   *   - seconds 最大秒数
   *   - since 从某个时间开始
   *   - password 房间密码
   */
  static createJoinPres(
    room: string | JID,
    nick: string,
    options?: JoinOptions
  ) {
    if (typeof room === "string") room = new JID(room);
    const roomJID = `${room.bare}/${nick}`;
    const pres = XMPPElement.createElement("presence", { to: roomJID });
    const x = XMPPElement.createElementNS(MUC.NS.BASE, "x");

    if (options) {
      const { maxchars, maxstanzas, seconds, since, password } = options;
      // 未指定任何历史条件时不附 <history/>（XEP-0045 §7.2.14，交由服务端默认行为）
      if (maxchars != null || maxstanzas != null || seconds != null || since != null) {
        const history = XMPPElement.createElement("history");
        // 注意：maxchars 和 maxstanzas 允许值为0，表示不接受历史消息，所以需要单独判断是否为 null 或 undefined
        if (maxchars != null) history.setAttribute("maxchars", maxchars.toString());
        if (maxstanzas != null) history.setAttribute("maxstanzas", maxstanzas.toString());
        if (seconds != null) history.setAttribute("seconds", seconds.toString());
        if (since != null) history.setAttribute("since", since.toISOString());
        // NOTE：有顺序要求
        x.appendChild(history);
      }
      if (password) {
        const passwordElement = XMPPElement.createElement("password");
        passwordElement.textContent = password;
        x.appendChild(passwordElement);
      }
    }
    pres.appendChild(x);
    return pres;
  }

  /**
   * 离开MUC
   * @param to 包含自己昵称的完整的room JID
   * @param reason 原因
   */
  static createLeavePres(to: string | JID, reason?: string) {
    if (typeof to !== "string") to = to.toString();
    // 必须有 resource（昵称），即完整 occupant JID
    if (!to.includes("/")) {
      throw new Error(`createLeavePres: to 必须为包含昵称的完整 occupant JID（如 room@conference.example/nick）`);
    }
    const pres = XMPPElement.createElement("presence", {
      to,
      type: "unavailable",
    });
    if (reason) {
      const status = XMPPElement.createElement("status");
      status.textContent = reason;
      pres.appendChild(status);
    }
    return pres;
  }

  static createSetNickPres(room: string | JID, nick: string) {
    if (typeof room === "string") room = new JID(room);

    const roomJID = `${room.bare}/${nick}`;
    const pres = XMPPElement.createElement("presence", {
      to: roomJID,
      id: crypto.randomUUID(),
    });
    return pres;
  }

  static createMediatedInvite(room: string | JID, recipient: string | JID, reason = "") {
    const message = XMPPElement.createElement("message", {
      to: room.toString(),
    });
    const x = XMPPElement.createElementNS(MUC.NS.USER, "x");
    const invite = XMPPElement.createElement("invite", {
      to: recipient.toString(),
    });
    const reasonElement = XMPPElement.createElement("reason");
    reasonElement.textContent = reason;
    invite.appendChild(reasonElement);
    x.appendChild(invite);
    message.appendChild(x);
    return message;
  }

  /**
   * 查询房间中预留的昵称（XEP-0045 §7.12）
   * @param room 房间 JID
   * @returns disco#info 查询 IQ，node 为 x-roomuser-item
   */
  static createGetReservedNickIq(room: string | JID) {
    if (typeof room !== "string") room = room.toString();
    const iq = XMPPElement.createElement("iq", { to: room, type: "get" });
    const query = XMPPElement.createElementNS(Disco.NS.DISCO_INFO, "query", {
      node: "x-roomuser-item",
    });
    iq.appendChild(query);
    return iq;
  }

  static createRequestVoiceMsg(room: string | JID) {
    if (typeof room !== "string") room = room.toString();
    // XXX: 感觉不如从字符串构建
    const form = Form.createFormEl({
      type: "submit",
      fields: [
        {
          var: "FORM_TYPE",
          values: ["http://jabber.org/protocol/muc#request"],
        },
        {
          var: "muc#role",
          type: "list-single",
          label: "Requested role",
          values: ["participant"],
        },
      ],
    });

    const message = XMPPElement.createElement("message", { to: room });
    message.appendChild(form);
    return message;
  }

  static createSetSubjectMsg(room: string | JID, subject: string) {
    const to = typeof room === "string" ? new JID(room).bare : room.bare;
    const message = XMPPElement.createElement("message", {
      to,
      type: "groupchat",
    });
    const subjectElement = XMPPElement.createElement("subject");
    subjectElement.textContent = subject;
    message.appendChild(subjectElement);
    return message;
  }

  static createSetAffiliationIq(
    room: string | JID,
    jid: string | JID,
    affiliation: "none" | "outcast" | "member" | "admin" | "owner",
    reason?: string
  ) {
    if (typeof room !== "string") room = room.toString();
    if (typeof jid !== "string") jid = jid.toString();

    const iq = XMPPElement.createElement("iq", { to: room, type: "set" });

    const query = XMPPElement.createElementNS(MUC.NS.ADMIN, "query");
    const item = XMPPElement.createElement("item", {
      jid,
      affiliation,
    });

    if (reason) {
      const reasonEl = XMPPElement.createElement("reason");
      reasonEl.textContent = reason;
      item.appendChild(reasonEl);
    }

    query.appendChild(item);
    iq.appendChild(query);
    return iq;
  }

  static createSetRoleIq(
    room: string | JID,
    nick: string | JID,
    role: "none" | "visitor" | "participant" | "moderator",
    reason?: string
  ) {
    if (typeof room !== "string") room = room.toString();
    if (typeof nick !== "string") nick = nick.toString();
    const iq = XMPPElement.createElement("iq", { to: room, type: "set" });

    const query = XMPPElement.createElementNS(MUC.NS.ADMIN, "query");
    const item = XMPPElement.createElement("item", { nick, role });
    if (reason) {
      const reasonEl = XMPPElement.createElement("reason");
      reasonEl.textContent = reason;
      item.appendChild(reasonEl);
    }
    query.appendChild(item);
    iq.appendChild(query);
    return iq;
  }

  static createGetRoomConfigIq(room: string | JID) {
    if (typeof room !== "string") room = room.toString();
    const iq = XMPPElement.createElement("iq", { to: room, type: "get" });

    const query = XMPPElement.createElementNS(MUC.NS.OWNER, "query");
    iq.appendChild(query);
    return iq;
  }

  static createSetRoomConfigIq(room: string | JID, form: DataForm) {
    if (typeof room !== "string") room = room.toString();
    const iq = XMPPElement.createElement("iq", { to: room, type: "set" });

    const query = XMPPElement.createElementNS(MUC.NS.OWNER, "query");
    const formEl = Form.createFormEl(form);
    query.appendChild(formEl);
    iq.appendChild(query);
    return iq;
  }

  /**
   * 解析 muc#user 扩展。
   * message stanza 可能只包含状态码，不一定包含 item。
   */
  static parsePresUser(xEl: XMPPElement): { muc: MUCUserPres } {
    if (xEl.tagName !== "x") return { muc: {} };

    const statuses = Array.from(xEl.getElementsByTagName("status"))
      .map((status) => status.getAttribute("code"))
      .filter((code): code is string => code !== null);

    const declineEl = xEl.getElementsByTagName("decline")[0];
    if (declineEl) {
      return {
        muc: {
          decline: {
            to: declineEl.getAttribute("to") ?? undefined,
            from: declineEl.getAttribute("from") ?? undefined,
            reason: declineEl.getElementsByTagName("reason")[0]?.textContent ?? undefined,
          },
          statuses,
        },
      };
    }

    const inviteElements = Array.from(xEl.getElementsByTagName("invite"));
    if (inviteElements.length > 0) {
      const invites = inviteElements.map((invite) => {
        const continueEl = invite.getElementsByTagName("continue")[0];
        return {
          to: invite.getAttribute("to") ?? undefined,
          from: invite.getAttribute("from") ?? undefined,
          reason: invite.getElementsByTagName("reason")[0]?.textContent ?? undefined,
          thread: invite.getAttribute("thread") ?? undefined,
          continue: continueEl
            ? { thread: continueEl.getAttribute("thread") ?? undefined }
            : undefined,
        };
      });

      return {
        muc: {
          invites,
          password: xEl.getElementsByTagName("password")[0]?.textContent ?? undefined,
          statuses,
        },
      };
    }

    const itemElements = xEl.getElementsByTagName("item");
    if (itemElements.length > 1) {
      log.warn("muc#user 包含多个 item，仅解析第一个", () => xEl.toXMLString());
    }

    const itemEl = itemElements[0];
    let item: MUCItem | undefined;
    if (itemEl) {
      const affiliationValue = itemEl.getAttribute("affiliation");
      const affiliation = MUC.AFFILIATION.find(
        (allowed) => allowed === affiliationValue
      );
      if (affiliationValue && !affiliation) {
        log.warn(`未知的 muc#user item affiliation: ${affiliationValue}`);
      }
      const roleValue = itemEl.getAttribute("role");
      const role = MUC.ROLE.find((allowed) => allowed === roleValue);
      if (roleValue && !role) {
        log.warn(`未知的 muc#user item role: ${roleValue}`);
      }

      const actorEl = itemEl.getElementsByTagName("actor")[0];
      const actorJid = actorEl?.getAttribute("jid") ?? undefined;
      const actorNick = actorEl?.getAttribute("nick") ?? undefined;
      // affiliation / role 可能只出现其一（如 §8.5 授权发言只带 role、§9.5 只带 affiliation），二者都可缺省
      item = {
        affiliation,
        role,
        jid: itemEl.getAttribute("jid") ?? undefined,
        nick: itemEl.getAttribute("nick") ?? undefined,
        reason: itemEl.getElementsByTagName("reason")[0]?.textContent ?? undefined,
        actor: actorJid || actorNick
          ? { jid: actorJid, nick: actorNick }
          : undefined,
      };
    }

    const destroyEl = xEl.getElementsByTagName("destroy")[0];
    if (destroyEl) {
      return {
        muc: {
          item,
          statuses,
          destroy: {
            jid: destroyEl.getAttribute("jid") ?? undefined,
            password: destroyEl.getElementsByTagName("password")[0]?.textContent ?? undefined,
            reason: destroyEl.getElementsByTagName("reason")[0]?.textContent ?? undefined,
          },
        },
      };
    }

    return {
      muc: {
        item,
        statuses,
      },
    };
  }
}
