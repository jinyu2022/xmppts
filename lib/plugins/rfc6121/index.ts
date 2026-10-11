import type { Plugin } from "../types";
import type Connection from "@/connection";
import { XMPPElement } from "@/ltx";
import { Presence, Iq } from "@/stanza";
import { XMPPError } from "@/errors";

/** 订阅状态：none=无 to=已订阅对方 from=被对方订阅 both=双向 remove=待删除 */
type Subscription = "none" | "to" | "from" | "both" | "remove";
/** 名册项 */
export interface Roster {
  /** 是否已被预批准订阅 */
  approved: boolean;
  /** 联系人 JID */
  jid: string;
  /** 备注名 */
  name?: string;
  /** 待处理状态，subscribe 表示已发出订阅请求尚未被批准 */
  ask?: "subscribe";
  /** 订阅状态 */
  subscription: Subscription;
}

/**
 * RFC6121: XMPP 即时消息和存在
 * @see https://datatracker.ietf.org/doc/html/rfc6121
 */
class RFC6121 implements Plugin {
  static readonly NS = "jabber:iq:roster" as const;
  readonly connection: Connection;
  constructor(connection: Connection) {
    this.connection = connection;
  }

  init() {
    this.connection.registerStanzaPlugin(RFC6121.NS, RFC6121.parseRosterEl);
    this.connection.registerEventPlugin("roster:update", {
      tagName: "iq",
      matcher: (iq) => {
        //RFC 6121 §2.1.6 明确：roster push 的 `from` 必须是账户自身的 bare JID（缺失时视为隐式来自自身），否则客户端 MUST 忽略（否则任何实体都能伪造花名册推送）。
        return (
          iq.type === "set" &&
          iq.roster !== void 0 &&
          iq.from.bare === this.connection.jid.bare
        );
      },
    });

    // 回应roster更新，本地更新另作处理
    this.connection.on("roster:update", (iq) => {
      const iqEl = Iq.createIq("result", iq.from);
      iqEl.setAttribute("id", iq.id!);
      this.connection.send(iqEl);
    });
  }

  /**
   * 获取当前账号的名册列表。
   *
   * @returns 名册项数组
   * @throws 服务器返回错误时抛出 XMPPError
   */
  async getRoster() {
    const iq = Iq.createIq("get", void 0, RFC6121.NS);
    const res = await this.connection.sendAsync(iq);
    if (res.getAttribute("type") === "error") {
      throw new XMPPError(res, "获取roster失败");
    }
    const rosterEl = res.getElementsByTagNameNS(RFC6121.NS, "query")[0];
    const roster = RFC6121.parseRosterEl(rosterEl).roster;

    return roster;
  }

  /**
   * 新增或更新一个名册项。
   * RFC 6121 §2.4 为原子更新：未提供的字段会被服务器置空
   *
   * @param jid - 联系人 JID
   * @param name - 备注名；省略则清空 name
   * @param group - 分组名；省略则移出全部分组
   * @throws 服务器返回错误时抛出 XMPPError
   */
  async setRoster(jid: string, name?: string, group?: string) {
    const iqEl = Iq.createIq("set", void 0, RFC6121.NS);
    const item = XMPPElement.createElement("item", { jid });
    if (name) {
      item.setAttribute("name", name);
    }
    if (group) {
      const groupEl = XMPPElement.createElement("group");
      groupEl.textContent = group;
      item.appendChild(groupEl);
    }
    iqEl.getElementsByTagNameNS(RFC6121.NS, "query")[0].appendChild(item);
    const res = await this.connection.sendAsync(iqEl);
    if (res.getAttribute("type") === "error") {
      throw new XMPPError(res, "设置roster失败");
    }
  }

  /**
   * 删除一个名册项。
   *
   * @param jid - 要删除的联系人 JID
   * @throws 服务器返回错误时抛出 XMPPError
   */
  async removeRoster(jid: string) {
    const iq = Iq.createIq("set", void 0, RFC6121.NS);
    const item = XMPPElement.createElement("item", {
      jid,
      subscription: "remove",
    });
    iq.getElementsByTagNameNS(RFC6121.NS, "query")[0].appendChild(item);
    const res = await this.connection.sendAsync(iq);
    if (res.getAttribute("type") === "error") {
      throw new XMPPError(res, "删除roster失败");
    }
  }

  /** 请求订阅对方的存在状态 */
  requestSubscription(jid: string) {
    const presence = Presence.createPresence(jid, "subscribe");
    this.connection.send(presence);
  }

  /** 撤销被订阅/拒绝订阅请求/取消预批准 */
  removeSubscription(jid: string) {
    const presence = Presence.createPresence(jid, "unsubscribed");
    this.connection.send(presence);
  }

  /** 取消订阅 */
  cancelSubscribe(jid: string) {
    const presence = Presence.createPresence(jid, "unsubscribe");
    this.connection.send(presence);
  }

  /** 预批准被订阅请求/批准订阅请求 */
  approveSubscription(jid: string) {
    const presence = Presence.createPresence(jid, "subscribed");
    this.connection.send(presence);
  }

  /**
   * 解析 roster 查询结果元素为名册数组。
   *
   * @param el - 命名空间为 jabber:iq:roster 的 query 元素
   * @throws 元素命名空间不匹配时抛出普通 Error
   */
  static parseRosterEl(el: XMPPElement): { roster: Roster[] } {
    if (el.namespaceURI !== RFC6121.NS) throw new Error("不是一个roster");
    const items = el.getElementsByTagName("item");
    const rosters = Array.from(items).map((item) => {
      const approved = item.getAttribute("approved") === "true";
      const jid = item.getAttribute("jid")!;
      const name = item.getAttribute("name") ?? void 0;
      const ask = (item.getAttribute("ask") as "subscribe" | null) ?? void 0;
      const subscription = (item.getAttribute("subscription") ??
        "none") as Subscription;
      return { approved, jid, name, ask, subscription };
    });

    return { roster: rosters };
  }
}

declare module "@/connection" {
  export interface SocketEventMap {
    /** RFC6121，你自己根据subscription判断是添还是删除 */
    "roster:update": Iq;
  }
}

declare module "../../stanza" {
  export interface Iq {
    roster?: Roster[];
  }
}
export default RFC6121;
