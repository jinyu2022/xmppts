const escapeXMLTable = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
} as const;

/**
 * 替换匹配到的特殊字符为 XML 实体
 * @param match 匹配到的特殊字符
 * @returns 对应的 XML 实体
 */
function escapeXMLReplace(match: keyof typeof escapeXMLTable) {
  return escapeXMLTable[match];
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
  const result = unescapeXMLTable[match as keyof typeof unescapeXMLTable];
  if (result) {
    return result;
  } else {
    throw new Error("Illegal XML entity " + match);
  }
}

/**
 * 转义 XML 属性值或元素名称中的特殊字符 (&, <, >, ", ')
 */
export function escapeXML(s: string): string {
   // @ts-expect-error replace 参数类型推断有误，escapeXMLReplace必定传入"&'<>
  return s.replace(/["&'<>]/g, escapeXMLReplace);
}
/**
 * 反转义 XML 属性值或元素名称中的实体引用
 */
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

  // shortcut if loop never entered:
  // return the original string without creating new objects
  if (previous === 0) return s;

  // push the remaining characters
  result = result + s.substring(previous);

  return result;
}

/**
 * 转义 XML 文本内容中的特殊字符 (&, <, >)
 */
export function escapeXMLText(s: string): string {
  // @ts-expect-error replace 参数类型推断有误，escapeXMLReplace必定传入&<>
  return s.replace(/[&<>]/g, escapeXMLReplace);
}

/**
 * 反转义 XML 文本内容中的实体引用 (&amp;, &lt;, &gt;)
 */
export function unescapeXMLText(s: string): string {
  // 仅处理文本中常见的实体，包括数字实体
  return s.replace(
    /&(amp|#38|lt|#60|gt|#62|#x26|#x3c|#x3e);/g,
    unescapeXMLReplace
  );
}
