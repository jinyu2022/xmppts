import { describe, it, expect } from "vitest";
import { Correction } from "../../../lib/plugins/xep0308/correction";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";

/**
 * XEP-0308: Last Message Correction
 * @see https://xmpp.org/extensions/xep-0308.html
 * @version 1.2.1 (2022-05-17)
 *
 * 用例取自 §3 Use Case 的规范示例：客户端发出的更正消息（Example 4）测构造，
 * 收到的更正消息（Example 4）测解析；无示例分支按 §8 XML Schema 补充。
 */
describe("Correction", () => {
  const NS = "urn:xmpp:message-correct:0";

  describe("createReplaceEl", () => {
    it("Example 4：生成带 id 属性的 replace 元素", () => {
      const el = Correction.createReplaceEl("bad1");
      expect(el.tagName).toBe("replace");
      expect(el.namespaceURI).toBe(Correction.NS);
      expect(el.getAttribute("id")).toBe("bad1");
    });
  });

  describe("parseReplaceEl", () => {
    it("Example 4：解析合法的 replace 元素", () => {
      const el = Parser.parse(`<replace xmlns="${NS}" id="bad1"/>`);
      expect(Correction.parseReplaceEl(el)).toEqual({ replace: { id: "bad1" } });
    });

    it("命名空间非法时抛错", () => {
      const el = XMPPElement.createElementNS("urn:invalid", "replace");
      el.setAttribute("id", "bad1");
      expect(() => Correction.parseReplaceEl(el)).toThrow("非法命名空间的消息更正元素");
    });

    it("缺少 id 属性时抛错（§8 要求 id 必填）", () => {
      const el = XMPPElement.createElementNS(Correction.NS, "replace");
      expect(() => Correction.parseReplaceEl(el)).toThrow("消息更正元素缺少 id");
    });
  });

  describe("createCorrectionMessageEl", () => {
    it("Example 4：生成带 body 与 replace 的 chat 消息", () => {
      const msg = Correction.createCorrectionMessageEl(
        "juliet@capulet.net/balcony",
        "bad1",
        "But soft, what light through yonder window breaks?"
      );
      expect(msg.tagName).toBe("message");
      expect(msg.getAttribute("to")).toBe("juliet@capulet.net/balcony");
      expect(msg.getAttribute("type")).toBe("chat");
      expect(msg.getElementsByTagName("body")[0]?.textContent).toBe(
        "But soft, what light through yonder window breaks?"
      );
      const replaceEl = msg.getElementsByTagName("replace")[0];
      expect(replaceEl.namespaceURI).toBe(Correction.NS);
      expect(replaceEl.getAttribute("id")).toBe("bad1");
    });

    it("生成带 replace 元素的 groupchat 消息", () => {
      const msg = Correction.createCorrectionMessageEl(
        "room@muc.example.com",
        "orig-2",
        "Corrected group message",
        "groupchat"
      );
      expect(msg.getAttribute("type")).toBe("groupchat");
      expect(msg.getElementsByTagName("replace")[0].getAttribute("id")).toBe("orig-2");
    });

    it("newBody 为空时不生成 body", () => {
      const msg = Correction.createCorrectionMessageEl(
        "romeo@montague.net",
        "orig-3",
        "",
        "chat"
      );
      expect(msg.getElementsByTagName("body")[0]).toBeUndefined();
    });
  });

  describe("isCorrection", () => {
    it("含 replace 属性时返回 true", () => {
      const msg = { replace: { id: "bad1" } } as unknown as Message;
      expect(Correction.isCorrection(msg)).toBe(true);
    });

    it("不含 replace 属性时返回 false", () => {
      const msg = {} as unknown as Message;
      expect(Correction.isCorrection(msg)).toBe(false);
    });
  });

  describe("Example 4：收到的更正消息可解析出 replace", () => {
    it("从消息中取出 replace 并解析", () => {
      const xml = Parser.parse(`
        <message xmlns="jabber:client" to="juliet@capulet.net/balcony" id="good1">
          <body>But soft, what light through yonder window breaks?</body>
          <replace id="bad1" xmlns="${NS}"/>
        </message>
      `);
      const result = Correction.parseReplaceEl(xml.getElementsByTagName("replace")[0]);
      expect(result.replace.id).toBe("bad1");
    });
  });
});
