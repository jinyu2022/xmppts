/** 特殊字符 → 实体引用；引号仅属性值需要转义 */
const escapeXMLTable = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
} as const;

/**
 * 快速失败用的非全局正则（`.test()` 不进 JS 回调）
 *
 * 字符集须与 escapeXMLTable 的键保持同步，TEXT 版不含引号
 */
const NEEDS_ESCAPE_ATTR = /["&'<>]/;
const NEEDS_ESCAPE_TEXT = /[&<>]/;

/**
 * 手工扫描转义：无特殊字符时零分配返回原串，否则逐字符查表拼接
 * @param s 待转义字符串
 * @param needs 快速失败用的非全局正则
 * @param inAttribute 属性值需转义引号，元素文本不需要
 */
function escapeWith(s: string, needs: RegExp, inAttribute: boolean): string {
  if (!needs.test(s)) return s;
  let out = "";
  let last = 0;
  for (let i = 0, n = s.length; i < n; i++) {
    const ch = s.charAt(i);
    const entity = escapeXMLTable[ch as keyof typeof escapeXMLTable];
    if (entity === undefined) continue;
    // 引号只在属性值中需要转义
    if (!inAttribute && (ch === '"' || ch === "'")) continue;
    out += s.slice(last, i) + entity;
    last = i + 1;
  }
  return out + s.slice(last);
}

const unescapeXMLTable = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
} as const;

/**
 * 替换匹配到的 XML 实体为对应的字符
 *
 * 该函数处理预定义的命名实体 (如 &amp;) 和数字字符引用 (如 &#x20;)。
 *
 * @param match 匹配到的 XML 实体字符串
 * @returns 对应的字符
 * @throws {Error} 如果字符引用格式错误、引用了非法 XML 字符或未知命名实体
 */
function unescapeXMLReplace(match: string): string {
  // 处理数字字符引用 (&#nnn; 或 &#xnnn;)
  if (match.startsWith("&#")) {
    if (!/^&#(?:\d+|x[0-9a-fA-F]+);$/.test(match)) {
      throw new Error("Illegal XML entity " + match);
    }
    const isHex = match.startsWith("&#x");
    const numStr = isHex ? match.slice(3, -1) : match.slice(2, -1);
    const num = parseInt(numStr, isHex ? 16 : 10);

    // https://www.w3.org/TR/xml/#NT-Char 定义了合法的 XML 字符范围:
    // #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
    if (
      num === 0x9 ||
      num === 0xa ||
      num === 0xd ||
      (num >= 0x20 && num <= 0xd7ff) ||
      (num >= 0xe000 && num <= 0xfffd) ||
      (num >= 0x10000 && num <= 0x10ffff)
    ) {
      return String.fromCodePoint(num);
    }
    throw new Error("Illegal XML character 0x" + num.toString(16));
  }

  // 处理预定义的命名实体
  const result: string | undefined = unescapeXMLTable[match as keyof typeof unescapeXMLTable];
  if (result !== undefined) return result;
  throw new Error("Illegal XML entity " + match);
}

/** 转义 XML 属性值中的特殊字符：& < > " ' */
export function escapeXML(s: string): string {
  return escapeWith(s, NEEDS_ESCAPE_ATTR, true);
}

/** 反转义 XML 属性值中的实体引用；未知实体或非法字符引用抛错 */
export function unescapeXML(s: string): string {
  let result = "";
  let start: number;
  let end: number;
  let previous = 0;
  while (
    (start = s.indexOf("&", previous)) !== -1 &&
    (end = s.indexOf(";", start + 1)) !== -1
  ) {
    result =
      result +
      s.slice(previous, start) +
      unescapeXMLReplace(s.slice(start, end + 1));
    previous = end + 1;
  }

  // 循环未进入时直接返回原串，不创建新对象
  if (previous === 0) return s;

  // 追加剩余字符
  result = result + s.substring(previous);

  return result;
}

/** 转义 XML 文本内容中的特殊字符：& < > */
export function escapeXMLText(s: string): string {
  return escapeWith(s, NEEDS_ESCAPE_TEXT, false);
}

/**
 * 反转义 XML 文本内容中的实体引用，escapeXMLText 的逆向
 *
 * 仅还原 & < > 的命名、十进制、十六进制写法；白名单之外保持原样，不抛错
 */
export function unescapeXMLText(s: string): string {
  // 仅处理文本中常见的实体，包括数字实体
  return s.replace(
    /&(amp|#38|lt|#60|gt|#62|#x26|#x3c|#x3e);/g,
    unescapeXMLReplace
  );
}
