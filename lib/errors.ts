import { XMPPElement } from "./ltx/Element";
/** RFC 6120 §8.3.3 定义的 stanza 错误条件，供使用方比对；解析时不做过滤 */
export const ErrorConditions = [
  "bad-request",
  "conflict",
  "feature-not-implemented",
  "forbidden",
  "gone",
  "internal-server-error",
  "item-not-found",
  "jid-malformed",
  "not-acceptable",
  "not-allowed",
  "not-authorized",
  "payment-required",
  "recipient-unavailable",
  "redirect",
  "registration-required",
  "remote-server-not-found",
  "remote-server-timeout",
  "resource-constraint",
  "service-unavailable",
  "subscription-required",
  "undefined-condition",
  "unexpected-request",
] as const;

export type ErrorTypes = "auth" | "cancel" | "continue" | "modify" | "wait";

/** `<error/>` 的解析结果（RFC 6120 §8.3.2） */
export interface StanzaError {
  /** `type` 属性，必需（§8.3.2） */
  type: ErrorTypes;
  /** `by` 属性，可选（§8.3.1 规则 5） */
  by?: string;
  /** stanzas 命名空间下的条件元素名（§8.3.3） */
  condition: (typeof ErrorConditions)[number];
  /** stanzas 命名空间下的 `<text/>`，可选 */
  text?: string;
  /** 其它命名空间的附加条件元素（§8.3.4），按 tagName 索引 */
  [key: string]: unknown;
}

/**
 * 专门用于表达 XMPP 错误节的类，继承自 Error
 */
export class XMPPError extends Error {
  static readonly NS = "urn:ietf:params:xml:ns:xmpp-stanzas";
  declare readonly type: StanzaError["type"];
  declare readonly by: StanzaError["by"];
  declare readonly condition: StanzaError["condition"];
  declare readonly text: StanzaError["text"];
  // readonly xmlElement: Element;
  /** 标签名，message、persence、iq */
  readonly tagName: string;
  readonly xmlString: string;
  readonly to: string | null;
  readonly from: string | null;
  
  constructor(stanza: XMPPElement, message: string) {
    super(message);
    this.name = "XMPPError";
    this.tagName = stanza.tagName;
    this.to = stanza.getAttribute("to");
    this.from = stanza.getAttribute("from");
    this.xmlString = stanza.toXMLString();
    // <error/> 是节的直接子元素，避免误取载荷中嵌套的同名元素（如转发消息里的 error）
    const errorEl = stanza.querySelector(":scope > error");
    if (!errorEl) return;

    this.by = errorEl.getAttribute("by") ?? void 0;
    this.type = errorEl.getAttribute("type") as ErrorTypes;
    for (const child of errorEl.children) {
      if (child.namespaceURI !== XMPPError.NS) {
        // 不是stanza error命名空间下的元素
        continue;
      };
      Object.assign(this, XMPPError.parseErrorChildEl(child));
    }
  }

  /**
   * 解析 `<error/>` 的单个子元素，返回待合并到错误对象上的字段
   * @param el `<error/>` 的子元素，如 `conflict`、`text`
   * @throws 传入的不是 stanza error 命名空间下的元素
   */
  static parseErrorChildEl(el: XMPPElement): Partial<Pick<StanzaError, "condition" | "text">> {
    // 必须传入error的子元素才行！如 `conflict`，`text`
    if (el.namespaceURI !== XMPPError.NS) {
      throw new Error("不是一个stanza error元素");
    }
    return el.localName === "text"
      ? { text: el.textContent }
      : { condition: el.localName as (typeof ErrorConditions)[number] };
  };
}


/**
 * 专门用于表达超时错误的类，继承自 Error
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
