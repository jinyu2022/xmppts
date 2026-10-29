import type { Plugin } from "../types";
import type Connection from "@/connection";
import { XMPPElement } from "@/ltx";
import { Presence, Iq } from "@/stanza";
import { XMPPError } from "@/errors";
import { JID } from "@/JID";

/** RFC 6121 §2.1.2.5 定义的 subscription 取值 */
const SUBSCRIPTIONS = ["none", "to", "from", "both", "remove"] as const;
/** 订阅状态：none=无 to=已订阅对方 from=被对方订阅 both=双向 remove=待删除 */
type Subscription = typeof SUBSCRIPTIONS[number];
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
  /** 所属分组，允许同时属于多个分组（RFC 6121 §2.1.2.6） */
  groups: string[];
}

/**
 * RFC6121: XMPP 即时消息和存在
 * @see https://datatracker.ietf.org/doc/html/rfc6121
 */
class RFC6121 implements Plugin {
  static readonly NS = "jabber:iq:roster";
  readonly connection: Connection;
  constructor(connection: Connection) {
    this.connection = connection;
  }

  init() {
    this.connection.registerStanzaPlugin(RFC6121.NS, RFC6121.parseRosterEl);
    this.connection.registerEventPlugin("roster:update", {
      tagName: "iq",
      matcher: (iq) => {
        if (iq.type !== "set" || iq.roster === void 0) return false;
        // RFC 6121 §2.1.6：from 缺失视为来自自身 bare JID；存在时必须恰好是自身 bare JID，同账号的其他 resource 也不接受
        if (iq.xml.getAttribute("from") === null) return true;
        return (
          iq.from.resource === void 0 &&
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
   * @param group - 分组名或分组名数组；省略则移出全部分组
   * @throws 服务器返回错误时抛出 XMPPError；分组名为空串时抛出 Error（§2.3.3）
   */
  async setRoster(jid: string, name?: string, group?: string | string[]) {
    const groups = group === void 0 ? [] : Array.isArray(group) ? group : [group];
    // RFC 6121 §2.3.3：零长度的 group 会被服务器以 not-acceptable 拒绝
    if (groups.includes("")) throw new Error("分组名不能为空");
    const iqEl = Iq.createIq("set", void 0, RFC6121.NS);
    const item = XMPPElement.createElement("item", { jid });
    if (name) {
      item.setAttribute("name", name);
    }
    for (const groupName of groups) {
      const groupEl = XMPPElement.createElement("group");
      groupEl.textContent = groupName;
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

  /**
   * 请求订阅对方的存在状态。
   *
   * @param jid - 联系人 bare JID
   */
  requestSubscription(jid: string | JID) {
    const contact = typeof jid === "string" ? new JID(jid) : jid;
    // RFC 6121 §3.1.1：订阅 presence 的 to 必须是联系人的 bare JID
    const presence = Presence.createPresence(contact.bare, "subscribe");
    this.connection.send(presence);
  }

  /**
   * 撤销被订阅/拒绝订阅请求/取消预批准。
   *
   * @param jid - 联系人 bare JID
   */
  removeSubscription(jid: string | JID) {
    const contact = typeof jid === "string" ? new JID(jid) : jid;
    // RFC 6121 §3.1.1：订阅 presence 的 to 必须是联系人的 bare JID
    const presence = Presence.createPresence(contact.bare, "unsubscribed");
    this.connection.send(presence);
  }

  /**
   * 取消订阅。
   *
   * @param jid - 联系人 bare JID
   */
  cancelSubscribe(jid: string | JID) {
    const contact = typeof jid === "string" ? new JID(jid) : jid;
    // RFC 6121 §3.1.1：订阅 presence 的 to 必须是联系人的 bare JID
    const presence = Presence.createPresence(contact.bare, "unsubscribe");
    this.connection.send(presence);
  }

  /**
   * 预批准被订阅请求/批准订阅请求。
   *
   * @param jid - 联系人 bare JID
   */
  approveSubscription(jid: string | JID) {
    const contact = typeof jid === "string" ? new JID(jid) : jid;
    // RFC 6121 §3.1.1：订阅 presence 的 to 必须是联系人的 bare JID
    const presence = Presence.createPresence(contact.bare, "subscribed");
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
      // RFC 6120 §2.6：XML boolean 的真值可写作 "true" 或 "1"
      const approvedAttr = item.getAttribute("approved");
      const approved = (approvedAttr === "true" || approvedAttr === "1");
      const jid = item.getAttribute("jid")!;
      const name = item.getAttribute("name") ?? void 0;
      // RFC 6121 §2.1.2.2：ask 只有 subscribe 一种合法取值，其余值忽略
      const ask: Roster["ask"] =
        item.getAttribute("ask") === "subscribe" ? "subscribe" : void 0;
      // RFC 6121 §2.1.2.5：未定义的 subscription 取值忽略，按未提供处理（默认 none）
      const subscriptionAttr = item.getAttribute("subscription");
      const subscription =
        SUBSCRIPTIONS.find((value) => value === subscriptionAttr) ?? "none";
      // RFC 6121 §2.1.2.6：一个名册项可属于多个分组
      const groups = Array.from(
        item.getElementsByTagName("group"),
        (group) => group.textContent,
      );
      return { approved, jid, name, ask, subscription, groups };
    });

    return { roster: rosters };
  }
}

declare module "../../connection" {
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
