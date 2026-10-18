import { XMPPElement } from "@/ltx";

/**
 * 提取 stanza 中第一个非 text 子元素的 localName。
 *
 * 传入 `namespace` 时只接受该命名空间或空命名空间的元素，
 * 用于兼容未声明命名空间的实现。
 *
 * @param stanza 包含条件子元素的 stanza
 * @param fallback 未找到条件时返回的默认值
 * @param namespace 条件元素应属的命名空间；省略时接受任意命名空间
 */
export function firstCondition(
  stanza: XMPPElement,
  fallback: string,
  namespace?: string,
): string {
  for (const child of stanza.childNodes) {
    if (!(child instanceof XMPPElement) || child.localName === "text") {
      continue;
    }
    // 空命名空间视为兼容写法；非空时必须匹配
    if (namespace && child.namespaceURI && child.namespaceURI !== namespace) {
      continue;
    }
    return child.localName;
  }
  return fallback;
}
