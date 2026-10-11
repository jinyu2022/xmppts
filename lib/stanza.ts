import type { Connection } from "./connection";
import { XMPPElement } from "./ltx/Element";
import { XMPPError, type ErrorTypes, type StanzaError } from "./errors";
import { JID } from "./JID";
import logger from "./log";

const log = logger.getLogger("stanza");

/**away：离开 chat：在线 dnd：忙碌 xa：离开（长时间）*/
type presShow = "away" | "chat" | "dnd" | "xa";

/** message type 合法取值（RFC 6121 §5.2.2），用于运行时校验 */
const MSG_TYPES = ["normal", "chat", "groupchat", "headline", "error"] as const;

/**normal：普通消息（默认值） chat：聊天消息 groupchat：群聊消息 headline：广播/通知类消息 error：错误消息 */
export type MsgType = typeof MSG_TYPES[number];

export class StanzaBase {
  static readonly NS = "jabber:client" as const;

  /** TIP: 可以直接访问，但无法枚举 */
  declare private readonly connection: Connection;
  /** TIP: 可以直接访问，但无法枚举 */
  declare readonly xml: XMPPElement;
  /** 标签名，message、persence、iq */
  readonly tagName: string;
  // readonly xmlString: string;
  readonly id: string | null;
  /** 属性缺失（或空串）为 undefined */
  readonly to?: JID;
  /** 属性缺失时为自身 JID（RFC 6121 §8.1.2.1）；仅限顶层 stanza（走构造函数），转发节等深层 stanza 走静态 parse 方法，缺失时仍为 null */
  readonly from: JID;
  /** 直接子元素 `<error/>` 的解析结果，仅 `type="error"` 的节会有（RFC 6120 §8.3） */
  readonly error?: StanzaError;
  [key: string]: unknown;
  constructor(stanza: XMPPElement, connection: Connection) {
    // this.xml = stanza;
    Object.defineProperty(this, "xml", {
      value: stanza,
      writable: false, // 属性不可修改
      enumerable: false, // 属性不可枚举
      configurable: true, // 属性可删除或重新定义
    });
    this.tagName = stanza.tagName;
    this.id = stanza.getAttribute("id");
    const toAttr = stanza.getAttribute("to");
    const fromAttr = stanza.getAttribute("from");
    this.to = toAttr ? new JID(toAttr) : void 0;
    // from 属性缺失时，按 RFC 6121 §2.1.6 视为隐式来自自身 JID（仅顶层 stanza）
    this.from = fromAttr ? new JID(fromAttr) : connection.jid;
    // this.connection = connection;
    Object.defineProperty(this, "connection", {
      value: connection,
      writable: false, // 属性不可修改
      enumerable: false, // 属性不可枚举
      configurable: true, // 属性可删除或重新定义
    });
    // RFC 6120 §8.3.1 规则 7：type 非 error 时不允许出现 <error/>，故以 type 作前置判断
    if (stanza.getAttribute("type") === "error") {
      // 规则 4：error 类型的 stanza 必然带 <error/>，故此处直接非空断言
      const errorEl = stanza.querySelector(":scope > error")!;
      const error = {
        type: errorEl.getAttribute("type") as ErrorTypes,
        by: errorEl.getAttribute("by") ?? void 0,
      } as StanzaError;
      for (const child of errorEl.children) {
        if (child.namespaceURI !== XMPPError.NS) {
          // 其余命名空间的附加条件元素（§8.3.4）按 tagName 原样保留
          error[child.tagName] = child;
          continue;
        }
        Object.assign(error, XMPPError.parseErrorChildEl(child));
      }
      this.error = error;
    }
  }

  static parseBaseStanza(stanza: XMPPElement) {
    if (stanza.tagName === "iq") {
      return Iq.parseIq(stanza);
    } else if (stanza.tagName === "message") {
      return Message.parseMessage(stanza);
    } else if (stanza.tagName === "presence") {
      return Presence.parsePresence(stanza);
    } else {
      throw new Error("未知的stanza");
    }
  }

  send(xml: XMPPElement) {
    this.connection.send(xml);
  }

  /**
   * 添加一个只读属性
   * @param name 属性名
   * @param value 属性值
   */
  // addProperty<K extends keyof this>(name: K, value: this[K]) {
  //   Object.defineProperty(this, name, {
  //     value: value,
  //     writable: false, // 属性不可修改
  //     enumerable: true, // 属性可枚举
  //     configurable: true, // 属性可删除或重新定义
  //   });
  // }

  /**
   * @returns xml字符串
   */
  toString() {
    return this.xml.toXMLString();
  }
}

export class Iq extends StanzaBase {
  readonly type: "get" | "set" | "result" | "error";
  readonly tagName = "iq";
  constructor(stanza: XMPPElement, connection: Connection) {
    super(stanza, connection);
    const type = stanza.getAttribute("type") as Iq["type"] | null;
    // iq节点必须有type属性
    if (!type) throw new Error("iq节点必须有type属性");
    this.type = type;
  }

  static parseIq(iq: XMPPElement): Record<
    "iq",
    {
      id: string | null;
      to: JID | null;
      from: JID | null;
      type: "get" | "set" | "result" | "error";
      [key: string]: XMPPElement | string | JID | null;
    }
  > {
    const id = iq.getAttribute("id");
    let to: JID | string | null = iq.getAttribute("to");
    let from: JID | string | null = iq.getAttribute("from");
    to = to ? new JID(to) : null;
    from = from ? new JID(from) : null;
    const type = iq.getAttribute("type") as "get" | "set" | "result" | "error";
    const children: Record<string, XMPPElement> = {};
    for (const [index, child] of Array.from(iq.children).entries()) {
      children[`${child.tagName}-${index}`] = child;
    }
    return {
      iq: {
        id,
        to,
        from,
        type,
        ...children,
      },
    };
  }

  static createIq(
    type: "get" | "set" | "result" | "error",
    to?: JID | string,
    queryNS?: string
  ) {
    const iq = XMPPElement.createElementNS("jabber:client", "iq", { type });
    if (to) iq.setAttribute("to", to.toString());
    if (queryNS) {
      const query = XMPPElement.createElementNS(queryNS, "query");
      iq.appendChild(query);
    }
    return iq;
  }
}

export class Message extends StanzaBase {
  readonly type: MsgType;
  readonly tagName = "message";
  readonly subject?: string | null;
  /** 按 xml:lang 索引的 subject,仅含带语言标签的 */
  readonly subjects: Record<string, string>;
  readonly body?: string | null;
  /** 按 xml:lang 索引的 body,仅含带语言标签的 */
  readonly bodies: Record<string, string>;
  readonly thread?: string;
  constructor(stanza: XMPPElement, connection: Connection) {
    super(stanza, connection);
    const { type, subject, subjects, body, bodies, thread } =
      Message.parseMessage(stanza).message;
    this.type = type;
    this.subject = subject;
    this.subjects = subjects;
    this.body = body;
    this.bodies = bodies;
    this.thread = thread ?? undefined;
  }

  static parseMessage(message: XMPPElement): Record<
    "message",
    {
      to: JID | null;
      from: JID | null;
      type: MsgType;
      subject: string | null;
      subjects: Record<string, string>;
      body: string | null;
      bodies: Record<string, string>;
      thread: string | null;
      [key: string]: Element | string | JID | null | Record<string, string>;
    }
  > {
    // const id = message.getAttribute("id");
    let to: JID | string | null = message.getAttribute("to");
    let from: JID | string | null = message.getAttribute("from");
    to = to ? new JID(to) : null;
    from = from ? new JID(from) : null;
    // RFC 6121 §5.2.2：未携带或不认识 type 时一律按 normal 处理
    const rawType = message.getAttribute("type");
    let type: MsgType = "normal";
    if (rawType && MSG_TYPES.includes(rawType as MsgType)) {
      type = rawType as MsgType;
    } else {
      log.warn(rawType ? `未知的 message type: ${rawType}，按 normal 处理` : "message 节点缺少 type 属性，按 normal 处理");
    }
    
    // 单次遍历分组:subject/body 归组，thread 取第一个，其余子节点进 children
    const grouped: Record<"subject" | "body", XMPPElement[]> = {
      subject: [],
      body: [],
    };
    const children: Record<string, XMPPElement> = {};
    let thread: string | null = null;
    for (const [index, child] of Array.from(message.children).entries()) {
      if (child.tagName === "subject" || child.tagName === "body") {
        grouped[child.tagName].push(child);
      } else if (child.tagName === "thread") {
        // RFC 6121 §5.2.5：thread 至多一个
        thread = child.textContent;
      } else {
        children[`${child.tagName}-${index}`] = child;
      }
    }
    const [subject, subjects] = Message.collectLocalized(
      grouped.subject,
      "subject"
    );
    const [body, bodies] = Message.collectLocalized(
      grouped.body,
      "body"
    );
    return {
      message: {
        ...children,
        to,
        from,
        type,
        subject,
        subjects,
        body,
        bodies,
        thread
      },
    };
  }

  /**
   * 从元素数组中提取第一个文本及按 xml:lang 索引的文本
   * 多个元素中混有无语言标签者属违规(RFC 6121 §5.2.8),仅警告并取第一个
   */
  private static collectLocalized(
    elements: XMPPElement[],
    tagName: "subject" | "body"
  ): [first: string | null, texts: Record<string, string>] {
    // 单个元素不可能违规,直接短路
    if (elements.length === 1) {
      const el = elements[0];
      const lang = el.getAttribute("xml:lang");
      return [el.textContent ?? null, lang ? { [lang]: el.textContent ?? "" } : {}];
    }
    const texts: Record<string, string> = {};
    let missingLang = false;
    for (const el of elements) {
      const lang = el.getAttribute("xml:lang");
      if (lang) {
        texts[lang] = el.textContent ?? "";
      } else {
        missingLang = true;
      }
    }
    if (missingLang) {
      log.warn(`多个 ${tagName} 未携带 xml:lang,仅取第一个`);
    }
    return [elements[0]?.textContent ?? null, texts];
  }

  /**
   * 创建一个消息stanza
   * @param to 接收者JID或字符串
   * @param body 消息体
   * @param type 消息类型，默认为normal
   * @returns XMPPElement 消息stanza
   */
  static createMessage(to: JID | string, body?: string, type: MsgType = "normal") {
    const message = XMPPElement.createElementNS(StanzaBase.NS, "message", {
      to: to.toString(),
      type,
    });
    /** 消息体元素 */
    if (body) {
      const bodyEl = XMPPElement.createElement("body");
      bodyEl.textContent = body;
      message.appendChild(bodyEl);
    }
    return message;
  }
}

export class Presence extends StanzaBase {
  readonly type: string | null;
  readonly tagName = "presence";
  readonly show?: presShow;
  readonly status?: string | null;
  constructor(stanza: XMPPElement, connection: Connection) {
    super(stanza, connection);
    const { type, show, status } = Presence.parsePresence(stanza).presence;
    this.type = type;
    this.show = show;
    this.status = status;
  }

  static parsePresence(presence: XMPPElement): Record<
    "presence",
    {
      to: JID | null;
      from: JID | null;
      type: string | null;
      show: presShow | undefined;
      status: string | null | undefined;
      [key: string]: XMPPElement | string | JID | null | undefined;
    }
  > {
    let to: JID | string | null = presence.getAttribute("to");
    let from: JID | string | null = presence.getAttribute("from");
    to = to ? new JID(to) : null;
    from = from ? new JID(from) : null;
    const type = presence.getAttribute("type");
    // 单次遍历,找到 show/status 后分支短路;其余子节点按唯一键收集
    let show: presShow | undefined;
    let status: string | null | undefined;
    const children: Record<string, XMPPElement> = {};
    for (const [index, child] of Array.from(presence.children).entries()) {
      if (show === undefined && child.tagName === "show") {
        show = child.textContent as presShow;
      } else if (status === undefined && child.tagName === "status") {
        status = child.textContent;
      } else {
        children[`${child.tagName}-${index}`] = child;
      }
    }
    return {
      presence: {
        ...children,
        to,
        from,
        type,
        show,
        status,
      },
    };
  }

  /**
   * 创建一个presence节
   * @param to 接收者
   * @param type 类型
   *   - subscribe 订阅
   *   - unsubscribe 取消订阅
   *   - unavailable 下线
   *   - subscribed 订阅成功
   *   - unsubscribed 取消订阅成功
   */
  static createPresence(
    to: JID | string,
    type?: "subscribe" | "unsubscribe" | "unavailable" | "subscribed" | "unsubscribed",
  ) {
    const presence = XMPPElement.createElementNS(StanzaBase.NS, "presence", {
      to: to.toString(),
    });
    if (type) presence.setAttribute("type", type);
    return presence;
  }
}
