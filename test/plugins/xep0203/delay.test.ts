import { describe, it, expect } from "vitest";
import { Delay } from "../../../lib/plugins/xep0203/delay";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0203: Delayed Delivery
 * @see https://xmpp.org/extensions/xep-0203.html
 * @version 2.0 (2009-09-15)
 *
 * 用例取自 §3 Examples：服务器下发的 delay（Example 1/2/3）测解析，
 * 发送方构造 delay 时以 Example 1 为准；无示例分支按 §8 XML Schema 补充。
 */
describe("Delay", () => {
  describe("createDelayEl", () => {
    it("Example 1：生成带 stamp、from 与 reason 的 delay 元素", () => {
      const stamp = new Date(Date.UTC(2002, 8, 10, 23, 8, 25));
      const el = Delay.createDelayEl(stamp, "capulet.com", "Offline Storage");
      expect(el.tagName).toBe("delay");
      expect(el.namespaceURI).toBe(Delay.NS);
      expect(el.getAttribute("stamp")).toBe("2002-09-10T23:08:25Z");
      expect(el.getAttribute("from")).toBe("capulet.com");
      expect(el.textContent).toBe("Offline Storage");
    });

    it("Example 3：无 reason 的 delay 元素", () => {
      const stamp = new Date(Date.UTC(2002, 8, 10, 23, 5, 37));
      const el = Delay.createDelayEl(stamp, "coven@macbeth.shakespeare.lit", "");
      expect(el.getAttribute("stamp")).toBe("2002-09-10T23:05:37Z");
      expect(el.getAttribute("from")).toBe("coven@macbeth.shakespeare.lit");
    });
  });

  describe("parseDelayEl", () => {
    it("Example 1：从离线消息中解析 delay 的 stamp/from/reason", () => {
      const xml = Parser.parse(`
        <message from="romeo@montague.net/orchard" to="juliet@capulet.com" type="chat">
          <body>O blessed, blessed night!</body>
          <delay xmlns="urn:xmpp:delay" from="capulet.com" stamp="2002-09-10T23:08:25Z">
            Offline Storage
          </delay>
        </message>
      `);
      const result = Delay.parseDelayEl(xml);
      expect(result.delay.from).toBe("capulet.com");
      expect(result.delay.reason?.trim()).toBe("Offline Storage");
      expect(result.delay.stamp.getTime()).toBe(Date.UTC(2002, 8, 10, 23, 8, 25));
    });

    it("Example 2：从 presence 中解析无 reason 的 delay", () => {
      const xml = Parser.parse(`
        <presence from="juliet@capulet.com/balcony" to="romeo@montague.net">
          <status>anon!</status>
          <delay xmlns="urn:xmpp:delay" from="juliet@capulet.com/balcony" stamp="2002-09-10T23:41:07Z"/>
        </presence>
      `);
      const result = Delay.parseDelayEl(xml);
      expect(result.delay.from).toBe("juliet@capulet.com/balcony");
      expect(result.delay.reason).toBeUndefined();
      expect(result.delay.stamp.getTime()).toBe(Date.UTC(2002, 8, 10, 23, 41, 7));
    });

    it("Example 3：从房间缓存消息中解析 delay", () => {
      const xml = Parser.parse(`
        <message from="coven@macbeth.shakespeare.lit/secondwitch" to="macbeth@shakespeare.lit/laptop" type="groupchat">
          <body>By the pricking of my thumbs</body>
          <delay xmlns="urn:xmpp:delay" from="coven@macbeth.shakespeare.lit" stamp="2002-09-10T23:05:37Z"/>
        </message>
      `);
      const result = Delay.parseDelayEl(xml);
      expect(result.delay.from).toBe("coven@macbeth.shakespeare.lit");
      expect(result.delay.stamp.getTime()).toBe(Date.UTC(2002, 8, 10, 23, 5, 37));
    });

    it("未找到 delay 元素时抛错", () => {
      const el = XMPPElement.createElement("message");
      expect(() => Delay.parseDelayEl(el)).toThrow("未找到 delay 标签");
    });

    it("stamp 非 dateTime 时抛错（§8 要求 xs:dateTime）", () => {
      const xml = Parser.parse(
        `<delay xmlns='urn:xmpp:delay' stamp='not-a-date' from='capulet.com'/>`
      );
      expect(() => Delay.parseDelayEl(xml)).toThrow("不是合法的 dateTime");
    });
  });
});
