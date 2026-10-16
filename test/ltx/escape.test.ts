import { describe, expect, it } from "vitest";
import {
  escapeXML,
  escapeXMLText,
  unescapeXML,
  unescapeXMLText,
} from "../../lib/ltx/escape";

describe("escapeXML / escapeXMLText", () => {
  it("属性值转义五个特殊字符", () => {
    expect(escapeXML(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("文本转义不处理引号", () => {
    expect(escapeXMLText(`<&>"'`)).toBe(`&lt;&amp;&gt;"'`);
  });

  it("无特殊字符时原样返回", () => {
    expect(escapeXML("hello 世界")).toBe("hello 世界");
  });
});

describe("unescapeXML", () => {
  it("还原预定义实体", () => {
    expect(unescapeXML("&lt;&amp;&gt;&quot;&apos;")).toBe(`<&>"'`);
  });

  it("还原十进制与十六进制字符引用", () => {
    expect(unescapeXML("&#65;&#x42;")).toBe("AB");
  });

  it("XML 1.0 §4.1 示例的十六进制引用还原为小于号", () => {
    expect(unescapeXML("(&#x3C;) to save options.")).toBe("(<) to save options.");
  });

  it("保留前导零及十六进制数字的大小写支持", () => {
    expect(unescapeXML("&#00065;&#x00041;&#x3c;&#x3C;")).toBe("AA<<");
  });

  it.each([0x9, 0xa, 0xd, 0x20, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff])(
    "XML 1.0 §2.2：还原合法码点 %i 的十进制和十六进制引用",
    (codePoint) => {
      const expected = String.fromCodePoint(codePoint);
      expect(unescapeXML(`&#${codePoint};`)).toBe(expected);
      expect(unescapeXML(`&#x${codePoint.toString(16)};`)).toBe(expected);
    },
  );

  it.each([
    "&#65junk;", "&#x41junk;", "&#x0x41;", "&#65.0;", "&#65e0;",
    "&#+65;", "&#-65;", "&# 65;", "&#65 ;", "&#65\n;",
    "&#x+41;", "&#x 41;", "&#x41 ;", "&#;", "&#x;", "&#X41;",
  ])("XML 1.0 §4.1：拒绝不完整匹配文法的引用 %s", (reference) => {
    expect(() => unescapeXML(reference)).toThrow("Illegal XML entity");
  });

  it.each([0x0, 0x8, 0xb, 0xc, 0x1f, 0xd800, 0xdfff, 0xfffe, 0xffff, 0x110000])(
    "拒绝非法 XML 码点 %i",
    (codePoint) => {
      expect(() => unescapeXML(`&#${codePoint};`)).toThrow("Illegal XML character");
      expect(() => unescapeXML(`&#x${codePoint.toString(16)};`)).toThrow("Illegal XML character");
    },
  );

  it("转义后的引用文本不进行二次解码", () => {
    expect(unescapeXML("&amp;#65junk;&#38;#x41;")).toBe("&#65junk;&#x41;");
  });

  it("拒绝未知命名实体", () => {
    expect(() => unescapeXML("&unknown;")).toThrow("Illegal XML entity");
  });

  it("无实体时原样返回", () => {
    expect(unescapeXML("plain text")).toBe("plain text");
  });

  it("与 escapeXML 互为逆运算", () => {
    const source = `<a href="x">it's & that</a>`;
    expect(unescapeXML(escapeXML(source))).toBe(source);
  });
});

describe("unescapeXMLText", () => {
  it("只还原文本实体，忽略引号实体", () => {
    expect(unescapeXMLText("&amp;&lt;&gt;&#38;")).toBe("&<>&");
    expect(unescapeXMLText("&quot;&apos;")).toBe("&quot;&apos;");
  });

  it("还原十进制与十六进制数字引用", () => {
    expect(unescapeXMLText("&#60;&#62;")).toBe("<>");
    expect(unescapeXMLText("&#x26;&#x3c;&#x3e;")).toBe("&<>");
  });
});
