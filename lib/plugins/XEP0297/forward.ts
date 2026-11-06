import type { XMPPElement } from "@/ltx";
interface Base {
  message?: XMPPElement | null;
  presence?: XMPPElement | null;
  iq?: XMPPElement | null;
}
// 生成只包含一个键的对象类型的联合
export type Forwarded = {
  delay?: XMPPElement | null;
} & {
  [K in keyof Base]: Pick<Base, K>;
}[keyof Base];

export class Forward {
  static readonly NS = "urn:xmpp:forward:0";

  static parseForwardedEl(message: XMPPElement): { forwarded: Forwarded } {
    if (message.namespaceURI !== Forward.NS) {
      throw new Error(`不是一个 forwarded 元素: ${message.toXMLString()}`);
    }
    const forwardedEl =
      message.tagName === "forwarded"
        ? message
        : message.getElementsByTagName("forwarded")[0];
    if (!forwardedEl)
      throw new Error(`未找到forwarded标签: ${message.toXMLString()}`);
    // 按照规范应该只有一个"message" | "presence" | "iq"标签
    const children = Array.from(forwardedEl.children).filter(
      (child) =>
        ["message", "presence", "iq"].includes(child.tagName)
    );
    if (children.length !== 1) {
      throw new Error(
        `forwarded包含多个message | presence | iq: ${message.toXMLString()}`
      );
    }
    const stanza = children[0];
    const forwarded = { [stanza.tagName]: stanza } as Forwarded;
    // XEP-0297 §2：`<delay/>` 必须是 `<forwarded/>` 的直接子元素；
    // 递归查找会把被转发 stanza 自己的延迟误当成转发的延迟
    const delayEl = forwardedEl.querySelector(":scope > delay");
    if (delayEl) forwarded.delay = delayEl;
    return { forwarded };
  }
}
