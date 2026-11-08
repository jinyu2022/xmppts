import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Message } from "../../../lib/stanza";
import { Hints } from "../../../lib/plugins/xep0334/hints";

/**
 * XEP-0334 提示元素的解析与生成。
 *
 * @see https://xmpp.org/extensions/xep-0334.html 1.0.0 §3 Examples
 */
describe("XEP-0334 处理提示", () => {
  /** 取 XML 中第一个属于 hints 命名空间的子元素，作为解析入口 */
  function hintOf(xml: string): XMPPElement {
    const el = Parser.parse(xml);
    const hint = Array.from(el.children).find(
      (child) => child.namespaceURI === Hints.NS,
    );
    if (!hint) throw new Error(`没有提示元素: ${xml}`);
    return hint;
  }

  it("按元素解析 Example 1 的 no-copy 与 no-store", () => {
    // §3 Example 1
    const messageEl = Parser.parse(
      `<message from="romeo@montague.lit/laptop" to="juliet@capulet.lit/laptop">
         <body>V unir avtug'f pybnx gb uvqr zr sebz gurve fvtug</body>
         <no-copy xmlns="urn:xmpp:hints"/>
         <no-store xmlns="urn:xmpp:hints"/>
       </message>`,
    );
    const hintEls = Array.from(messageEl.children).filter(
      (child) => child.namespaceURI === Hints.NS,
    );

    expect(hintEls.map((hintEl) => Hints.parseHintEl(hintEl))).toEqual([
      { hints: ["no-copy"] },
      { hints: ["no-store"] },
    ]);
  });

  it("未知提示原样返回", () => {
    const hintEl = hintOf(
      `<message><unknown xmlns="urn:xmpp:hints"/></message>`,
    );

    expect(Hints.parseHintEl(hintEl)).toEqual({ hints: ["unknown"] });
  });

  it("命名空间不符时抛错", () => {
    const hintEl = Parser.parse(`<no-copy xmlns="urn:example:wrong"/>`);
    expect(() => Hints.parseHintEl(hintEl)).toThrow(
      "不是一个处理提示元素",
    );
  });

  it("createHintEls 按传入顺序生成元素，忽略重复项", () => {
    expect(
      Hints.createHintEls(["store", "no-copy"]).map((el) => el.localName),
    ).toEqual(["store", "no-copy"]);
    expect(
      Hints.createHintEls(["no-copy", "no-store"]).map((el) => el.localName),
    ).toEqual(["no-copy", "no-store"]);
    expect(
      Hints.createHintEls(["no-store", "no-store"]).map((el) => el.localName),
    ).toEqual(["no-store"]);

    const els = Hints.createHintEls(["no-store"]);
    expect(els.every((el) => el.namespaceURI === Hints.NS)).toBe(true);
  });

  it("applyHints 覆盖已有提示元素", () => {
    const message = Parser.parse(
      `<message to="juliet@capulet.lit/laptop">
         <store xmlns="urn:xmpp:hints"/>
       </message>`,
    );

    Hints.applyHints(message, ["no-store"]);

    const hints = Array.from(message.children).filter(
      (child) => child.namespaceURI === Hints.NS,
    );
    expect(hints.map((el) => el.localName)).toEqual(["no-store"]);
  });

  it("applyHints 支持直接传入消息元素", () => {
    // Message.createMessage 返回 XMPPElement，与 connection.send 的入参一致
    const message = Message.createMessage("juliet@capulet.lit/laptop");

    Hints.applyHints(message, ["no-copy", "no-store"]);

    expect(
      Array.from(message.children).map((child) => child.localName),
    ).toEqual(["no-copy", "no-store"]);
  });

  it("applyHints 传 null 会清除已有提示", () => {
    const message = Message.createMessage("juliet@capulet.lit/laptop");
    Hints.applyHints(message, ["no-store"]);

    Hints.applyHints(message, null);

    const hints = Array.from(message.children).filter(
      (child) => child.namespaceURI === Hints.NS,
    );
    expect(hints).toEqual([]);
  });

  it("applyHints 的入参在类型上要求至少一个提示且存储类互斥", () => {
    const message = Message.createMessage("juliet@capulet.lit/laptop");

    // @ts-expect-error 至少需要一个提示
    Hints.applyHints(message, []);
    // @ts-expect-error store 与 no-store 互斥
    Hints.applyHints(message, ["store", "no-store"]);
    // @ts-expect-error store 与 no-permanent-store 互斥
    Hints.applyHints(message, ["store", "no-permanent-store"]);
    // @ts-expect-error no-store 已包含 no-permanent-store 的要求
    Hints.applyHints(message, ["no-store", "no-permanent-store"]);
    // @ts-expect-error 同一个提示不能重复
    Hints.applyHints(message, ["no-store", "no-store"]);

    Hints.applyHints(message, ["store", "no-copy"]);
    Hints.applyHints(message, ["no-copy", "no-store"]);
    Hints.applyHints(message, ["no-copy"]);
  });

  it("applyHints 只允许对完整 JID 使用 no-copy", () => {
    const bare = Parser.parse(`<message to="juliet@capulet.lit"/>`);
    const full = Parser.parse(`<message to="juliet@capulet.lit/laptop"/>`);
    const noRecipient = Parser.parse(`<message/>`);

    expect(() => Hints.applyHints(bare, ["no-copy"])).toThrow();
    expect(() => Hints.applyHints(noRecipient, ["no-copy"])).toThrow(
      "完整 JID",
    );
    expect(() => Hints.applyHints(full, ["no-copy"])).not.toThrow();
  });
});
