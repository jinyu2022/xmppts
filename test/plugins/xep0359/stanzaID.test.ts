import { describe, it, expect } from "vitest";
import { StanzaID } from "../../../lib/plugins/xep0359/stanzaID";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0359: Unique and Stable Stanza IDs
 * @see https://xmpp.org/extensions/xep-0359.html
 * @version 0.7.0 (2023-02-20)
 *
 * 用例取自 §2/§4 规范示例：Example 1/2/4 测解析，createOriginId 对齐 Example 2；
 * 无示例分支按 §9 XML Schema 补充。
 */
describe("StanzaID", () => {
  describe("parseStanzaId", () => {
    it("Example 1：解析 stanza-id", () => {
      const el = Parser.parse(
        `<stanza-id xmlns="urn:xmpp:sid:0" id="de305d54-75b4-431b-adb2-eb6b9e546013" by="room@muc.example.com"/>`
      );
      expect(StanzaID.parseStanzaId(el)).toEqual({
        stanzaID: { id: "de305d54-75b4-431b-adb2-eb6b9e546013", by: "room@muc.example.com" },
      });
    });

    it("Example 2：解析 origin-id（无 by）", () => {
      const el = Parser.parse(
        `<origin-id xmlns="urn:xmpp:sid:0" id="de305d54-75b4-431b-adb2-eb6b9e546013"/>`
      );
      expect(StanzaID.parseStanzaId(el)).toEqual({
        originID: { id: "de305d54-75b4-431b-adb2-eb6b9e546013" },
      });
    });

    it("Example 4：解析 referenced-stanza", () => {
      const el = Parser.parse(
        `<referenced-stanza xmlns="urn:xmpp:sid:0" id="xep359-stanza-id" by="muc.example.org"/>`
      );
      expect(StanzaID.parseStanzaId(el)).toEqual({
        referencedStanza: { id: "xep359-stanza-id", by: "muc.example.org" },
      });
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(`<stanza-id xmlns="urn:invalid" id="test-1"/>`);
      expect(() => StanzaID.parseStanzaId(el)).toThrow("不是stanzaId命名空间");
    });
  });

  describe("createOriginId", () => {
    it("Example 2：按指定 id 生成 origin-id 元素", () => {
      const el = StanzaID.createOriginId("de305d54-75b4-431b-adb2-eb6b9e546013");
      expect(el.namespaceURI).toBe(StanzaID.NS);
      expect(el.tagName).toBe("origin-id");
      expect(el.getAttribute("id")).toBe("de305d54-75b4-431b-adb2-eb6b9e546013");
      expect(el.children).toHaveLength(0);
    });

    it("缺省时随机生成 id（§2.1 建议 UUID）", () => {
      const a = StanzaID.createOriginId();
      const b = StanzaID.createOriginId();
      expect(a.getAttribute("id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.getAttribute("id")).not.toBe(b.getAttribute("id"));
    });
  });
});
