import { describe, it, expect } from "vitest";
import { MessageReceipts } from "../../../lib/plugins/xep0184/messageReceipts";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0184: Message Delivery Receipts
 * @see https://xmpp.org/extensions/xep-0184.html
 * @version 1.4.0 (2018-08-02)
 *
 * 用例取自 §7 Protocol Format：客户端发出的 request（Example 3）与回执 received
 * （Example 4）测构造，两例同时用于测解析；无示例分支按 §11 XML Schema 补充。
 */
describe("MessageReceipts", () => {
  describe("createReceiptsEl", () => {
    it("Example 3：生成 request 元素", () => {
      const el = MessageReceipts.createReceiptsEl("request");
      expect(el.tagName).toBe("request");
      expect(el.namespaceURI).toBe(MessageReceipts.NS);
      expect(el.children).toHaveLength(0);
    });

    it("Example 4：生成带 id 的 received 元素", () => {
      const el = MessageReceipts.createReceiptsEl("received", "richard2-4.1.247");
      expect(el.tagName).toBe("received");
      expect(el.namespaceURI).toBe(MessageReceipts.NS);
      expect(el.getAttribute("id")).toBe("richard2-4.1.247");
    });

    it("received 缺 id 时抛错（§7 要求 id 必填）", () => {
      const create = MessageReceipts.createReceiptsEl as (
        type: string,
        id?: string,
      ) => XMPPElement;
      expect(() => create("received")).toThrow("回执响应需要提供消息ID");
    });
  });

  describe("parseReceipts", () => {
    it("Example 3：解析请求回执的 request 元素", () => {
      const msg = Parser.parse(`
        <message from="northumberland@shakespeare.lit/westminster" id="richard2-4.1.247" to="kingrichard@royalty.england.lit/throne">
          <body>My lord, dispatch; read o'er these articles.</body>
          <request xmlns="urn:xmpp:receipts"/>
        </message>
      `);
      const result = MessageReceipts.parseReceipts(msg.getElementsByTagName("request")[0]);
      expect(result.receipts.type).toBe("request");
      expect(result.receipts).not.toHaveProperty("id");
    });

    it("Example 4：解析回执消息的 received 元素", () => {
      const msg = Parser.parse(`
        <message from="kingrichard@royalty.england.lit/throne" id="bi29sg183b4v" to="northumberland@shakespeare.lit/westminster">
          <received xmlns="urn:xmpp:receipts" id="richard2-4.1.247"/>
        </message>
      `);
      const result = MessageReceipts.parseReceipts(msg.getElementsByTagName("received")[0]);
      expect(result.receipts).toEqual({ type: "received", id: "richard2-4.1.247" });
    });

    it("命名空间非法时抛错", () => {
      const el = XMPPElement.createElementNS("urn:invalid", "request");
      expect(() => MessageReceipts.parseReceipts(el)).toThrow("不是消息回执命名空间");
    });

    it("received 缺 id 时抛错（§4 要求 id 必填）", () => {
      const msg = Parser.parse(`
        <message id="bi29sg183b4v">
          <received xmlns="urn:xmpp:receipts"/>
        </message>
      `);
      expect(() =>
        MessageReceipts.parseReceipts(msg.getElementsByTagName("received")[0]),
      ).toThrow("received 回执缺少 id");
    });

    it("命名空间内未知元素抛错", () => {
      const el = XMPPElement.createElementNS(MessageReceipts.NS, "acknowledged");
      expect(() => MessageReceipts.parseReceipts(el)).toThrow("未知的消息回执元素");
    });
  });
});
