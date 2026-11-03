import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Fallback } from "../../../lib/plugins/xep0428/fallback";

/**
 * XEP-0428 fallback 的解析、生成与文本裁剪。
 *
 * @see https://xmpp.org/extensions/xep-0428.html 0.2.1 §2 Overview
 */
describe("XEP-0428 回退标记", () => {
  function fallbackOf(xml: string): XMPPElement {
    return Parser.parse(xml).getElementsByTagName("fallback")[0];
  }

  it("解析 §2 示例的引用回退", () => {
    // §2 Fallback Indicator 示例
    const el = fallbackOf(
      `<message to="anna@example.com" id="message-id2" type="groupchat">
         <body>
           > Anna wrote:
           > Hi, how are you?
           Great
         </body>
         <reply to="anna@example.com" id="message-id1" xmlns="urn:xmpp:reply:0"/>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0">
           <body start="0" end="33"/>
         </fallback>
       </message>`,
    );

    expect(Fallback.parseFallbackEl(el)).toEqual({
      fallbacks: [
        { for: "urn:xmpp:reply:0", body: [{ start: 0, end: 33 }] },
      ],
    });
  });

  it("从父元素收集多条 fallback", () => {
    const el = fallbackOf(
      `<message>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0"><body/></fallback>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reference:0"/>
       </message>`,
    );

    expect(Fallback.parseFallbackEl(el).fallbacks).toEqual([
      { for: "urn:xmpp:reply:0", body: [{}] },
      // 无子元素：正文与主题整体都是回退内容
      { for: "urn:xmpp:reference:0", body: [], subject: [] },
    ]);
  });

  it("缺少 for 时给出空串并保留结果", () => {
    const el = fallbackOf(
      `<message><fallback xmlns="urn:xmpp:fallback:0"/></message>`,
    );

    expect(Fallback.parseFallbackEl(el).fallbacks).toEqual([
      { for: "", body: [], subject: [] },
    ]);
  });

  it("非法偏移的区间被丢弃，不退化成整段回退", () => {
    const el = fallbackOf(
      `<message>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0">
           <body start="-1" end="abc"/>
         </fallback>
       </message>`,
    );

    // 无法按 xs:unsignedInt 解析的区间直接丢弃；该元素因此没有可剥离的区间
    expect(Fallback.parseFallbackEl(el).fallbacks).toEqual([
      { for: "urn:xmpp:reply:0" },
    ]);
    expect(
      Fallback.stripFallback("fallback text", undefined),
    ).toBe("fallback text");
  });

  it("同一元素中非法区间不影响合法区间", () => {
    const el = fallbackOf(
      `<message>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0">
           <body start="0" end="5"/>
           <body start="abc"/>
         </fallback>
       </message>`,
    );

    expect(Fallback.parseFallbackEl(el).fallbacks).toEqual([
      { for: "urn:xmpp:reply:0", body: [{ start: 0, end: 5 }] },
    ]);
  });

  it("空串偏移视为非法并丢弃区间", () => {
    const el = fallbackOf(
      `<message>
         <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0">
           <body start="" end="5"/>
         </fallback>
       </message>`,
    );

    expect(Fallback.parseFallbackEl(el).fallbacks).toEqual([
      { for: "urn:xmpp:reply:0" },
    ]);
  });

  it("stripFallback 按码点移除单个区间", () => {
    // "> Anna wrote:\n> Hi\n" 共 19 个码点
    const text = "> Anna wrote:\n> Hi\nGreat";
    expect(Fallback.stripFallback(text, [{ start: 0, end: 19 }])).toBe(
      "Great",
    );
  });

  it("stripFallback 支持多区间与 emoji 码点", () => {
    // emoji 占两个 UTF-16 单元，但只算一个码点
    expect(Fallback.stripFallback("👋hello", [{ start: 0, end: 1 }])).toBe(
      "hello",
    );
    expect(
      Fallback.stripFallback("abcdef", [
        { start: 0, end: 2 },
        { start: 4, end: 6 },
      ]),
    ).toBe("cd");
  });

  it("stripFallback 对空区间列表返回空串，未提供时原样返回", () => {
    expect(Fallback.stripFallback("abc", [])).toBe("");
    expect(Fallback.stripFallback("abc", undefined)).toBe("abc");
    expect(Fallback.stripFallback("abc", [{ start: 0, end: 100 }])).toBe("");
    expect(Fallback.stripFallback("abc", [{ end: 1 }])).toBe("bc");
    expect(Fallback.stripFallback("abc", [{ start: 1 }])).toBe("a");
  });

  it("createFallbackEl 生成 subject、body 的顺序与属性", () => {
    const el = Fallback.createFallbackEl({
      for: "urn:xmpp:reply:0",
      body: [{ start: 0, end: 33 }],
    });

    expect(el.namespaceURI).toBe(Fallback.NS);
    expect(el.getAttribute("for")).toBe("urn:xmpp:reply:0");
    const body = el.querySelector(":scope > body");
    expect(body?.getAttribute("start")).toBe("0");
    expect(body?.getAttribute("end")).toBe("33");
  });

  it("createFallbackEl 拒绝空的 for 与非法偏移", () => {
    expect(() => Fallback.createFallbackEl({ for: "" })).toThrow();
    expect(() =>
      Fallback.createFallbackEl({
        for: "urn:xmpp:reply:0",
        body: [{ start: -1 }],
      }),
    ).toThrow();
  });
});
