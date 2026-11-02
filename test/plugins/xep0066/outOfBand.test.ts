import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { OOB } from "../../../lib/plugins/xep0066/oob";

/**
 * XEP-0066: Out of Band Data
 * @see https://xmpp.org/extensions/xep-0066.html
 * @version 1.6 (2026-07-08)
 *
 * 用例取自 §2 Example 2（消息中的 OOB）。
 */
describe("OOB", () => {
  const EXAMPLE = `
    <x xmlns="jabber:x:oob">
      <url>http://www.jabber.org/images/psa-license.jpg</url>
      <desc>A license to Jabber!</desc>
    </x>`;

  describe("parseOobEl", () => {
    it("解析 url 与 desc", () => {
      expect(OOB.parseOobEl(Parser.parse(EXAMPLE))).toEqual({
        oob: {
          url: "http://www.jabber.org/images/psa-license.jpg",
          desc: "A license to Jabber!",
        },
      });
    });

    it("没有 desc 时只返回 url", () => {
      const el = Parser.parse(
        `<x xmlns="jabber:x:oob"><url>https://example.com/a</url></x>`,
      );
      expect(OOB.parseOobEl(el)).toEqual({
        oob: { url: "https://example.com/a" },
      });
    });

    it("缺少 url 时忽略该元素", () => {
      const el = Parser.parse(
        `<x xmlns="jabber:x:oob"><desc>no url</desc></x>`,
      );
      expect(OOB.parseOobEl(el)).toEqual({});
    });

    it("命名空间不符时抛错，元素名不符时忽略", () => {
      expect(() =>
        OOB.parseOobEl(
          Parser.parse(`<x xmlns="urn:xmpp:other"><url>https://a</url></x>`),
        ),
      ).toThrow("非法的 OOB 元素");
      expect(
        OOB.parseOobEl(
          Parser.parse(`<y xmlns="jabber:x:oob"><url>https://a</url></y>`),
        ),
      ).toEqual({});
    });
  });

  describe("createOobMessage", () => {
    it("生成带 url、desc 与正文的消息", () => {
      const message = OOB.createOobMessage(
        "romeo@montague.lit",
        "https://example.com/photo.jpg",
        { desc: "Photo", body: "https://example.com/photo.jpg" },
      );

      expect(message.getAttribute("to")).toBe("romeo@montague.lit");
      expect(message.getAttribute("type")).toBe("chat");
      expect(message.getElementsByTagName("body")[0].textContent).toBe(
        "https://example.com/photo.jpg",
      );

      const oob = message.getElementsByTagName("x")[0];
      expect(oob.namespaceURI).toBe(OOB.NS);
      expect(oob.getElementsByTagName("url")[0].textContent).toBe(
        "https://example.com/photo.jpg",
      );
      expect(oob.getElementsByTagName("desc")[0].textContent).toBe("Photo");
    });
  });
});
