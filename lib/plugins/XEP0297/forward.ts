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
    const forwarded =
      message.tagName === "forwarded"
        ? message
        : message.getElementsByTagName("forwarded")[0];
    if (!forwarded)
      throw new Error(`未找到forwarded标签: ${message.toXMLString()}`);
    const delayElement = forwarded.getElementsByTagName("delay")[0];
    // 按照规范应该只有一个"message" | "presence" | "iq"标签
    const childrens = Array.from(forwarded.children).filter(
      (child) =>
        ["message", "presence", "iq"].includes(child.tagName)
    );
    if (childrens.length !== 1) {
      throw new Error(
        `forwarded包含多个message | presence | iq: ${message.toXMLString()}`
      );
    }
    const childrenTag = childrens[0].tagName as keyof Base;
    return {
      forwarded: {
        delay: delayElement,
        [childrenTag]: childrens[0],
      },
    };
  }
}
