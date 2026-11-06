import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { Message } from "../../../lib/stanza";
import type { Connection } from "../../../lib/connection";
import Reply from "../../../lib/plugins/xep0461/reply";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0461: Message Replies
 * @see https://xmpp.org/extensions/xep-0461.html
 * @version 0.2.1 (2026-02-25)
 *
 * 用例取自 §3 Example 1/2 与 §3.1 关于引用 ID 的选择规则。
 */
describe("Reply", () => {
  const connection = new FakeConnection();

  function parseMessage(xml: string) {
    return new Message(
      Parser.parse(xml),
      connection as unknown as Connection,
    );
  }

  describe("parseReplyEl", () => {
    it("Example 2：解析 reply 的 to 与 id", () => {
      const reply = Parser.parse(
        `<reply to="anna@example.com/tablet" id="message-id1" xmlns="urn:xmpp:reply:0"/>`,
      );
      expect(Reply.parseReplyEl(reply)).toEqual({
        reply: { id: "message-id1", to: "anna@example.com/tablet" },
      });
    });

    it("缺少 to 时只保留 id（规范只要求 SHOULD）", () => {
      const reply = Parser.parse(
        `<reply id="message-id1" xmlns="urn:xmpp:reply:0"/>`,
      );
      expect(Reply.parseReplyEl(reply)).toEqual({
        reply: { id: "message-id1" },
      });
    });

    it("缺少 id 时忽略该元素", () => {
      const reply = Parser.parse(`<reply xmlns="urn:xmpp:reply:0"/>`);
      expect(Reply.parseReplyEl(reply)).toEqual({});
    });

    it("命名空间不符时抛错", () => {
      const reply = Parser.parse(
        `<reply xmlns="urn:example:wrong" id="message-id1"/>`,
      );
      expect(() => Reply.parseReplyEl(reply)).toThrow("不是一个 reply 元素");
    });
  });

  describe("getReferenceEl", () => {
    it("1:1 消息优先使用 origin-id", () => {
      const message = parseMessage(`
        <message from="anna@example.com/tablet" id="message-id1" type="chat">
          <origin-id xmlns="urn:xmpp:sid:0" id="origin-1"/>
        </message>`);
      const replyEl = Reply.getReferenceEl(message);

      expect(replyEl.namespaceURI).toBe(Reply.NS);
      expect(replyEl.getAttribute("to")).toBe("anna@example.com/tablet");
      expect(replyEl.getAttribute("id")).toBe("origin-1");
    });

    it("1:1 消息没有 origin-id 时使用 stanza 的 id", () => {
      const message = parseMessage(
        `<message from="anna@example.com/tablet" id="message-id1" type="chat"/>`,
      );
      const replyEl = Reply.getReferenceEl(message);

      expect(replyEl.getAttribute("to")).toBe("anna@example.com/tablet");
      expect(replyEl.getAttribute("id")).toBe("message-id1");
    });

    it("群聊消息使用房间分配的 stanza-id", () => {
      const message = parseMessage(`
        <message from="coven@chat.shakespeare.lit/firstwitch" type="groupchat" id="client-id">
          <stanza-id xmlns="urn:xmpp:sid:0" by="coven@chat.shakespeare.lit" id="39K7ZYIp"/>
        </message>`);
      const replyEl = Reply.getReferenceEl(message);

      expect(replyEl.getAttribute("to")).toBe(
        "coven@chat.shakespeare.lit/firstwitch",
      );
      expect(replyEl.getAttribute("id")).toBe("39K7ZYIp");
    });

    it("群聊消息缺少房间分配的 stanza-id 时抛错", () => {
      const message = parseMessage(
        `<message from="coven@chat.shakespeare.lit/firstwitch" type="groupchat" id="client-id"/>`,
      );
      expect(() => Reply.getReferenceEl(message)).toThrow(
        "缺少房间分配的 stanza-id",
      );
    });
  });

  describe("createReplyMessage", () => {
    it("Example 2：生成带 reply 的回复消息", () => {
      const message = Reply.createReplyMessage(
        "anna@example.com",
        Reply.createReplyEl("anna@example.com/tablet", "message-id1"),
        "Great idea!",
        "chat",
      );
      expect(message.getAttribute("to")).toBe("anna@example.com");
      expect(message.getAttribute("type")).toBe("chat");
      expect(message.getElementsByTagName("body")[0].textContent).toBe(
        "Great idea!",
      );

      const reply = message.getElementsByTagName("reply")[0];
      expect(reply.namespaceURI).toBe(Reply.NS);
      expect(reply.getAttribute("to")).toBe("anna@example.com/tablet");
      expect(reply.getAttribute("id")).toBe("message-id1");
    });

    it("提供 quotedBody 时生成引用块与 XEP-0428 fallback", () => {
      const message = Reply.createReplyMessage(
        "anna@example.com",
        Reply.createReplyEl("anna@example.com/tablet", "message-id1"),
        "Great idea!",
        "chat",
        "We should bake a cake",
      );

      expect(message.getElementsByTagName("body")[0].textContent).toBe(
        "> We should bake a cake\nGreat idea!",
      );

      const fallback = message.getElementsByTagName("fallback")[0];
      expect(fallback.namespaceURI).toBe(Reply.FALLBACK_NS);
      expect(fallback.getAttribute("for")).toBe(Reply.NS);

      const region = message.getElementsByTagNameNS(
        Reply.FALLBACK_NS,
        "body",
      )[0];
      expect(region.getAttribute("start")).toBe("0");
      expect(region.getAttribute("end")).toBe("24");
    });

    it("多行引用与 emoji 按码点计算 end", () => {
      const message = Reply.createReplyMessage(
        "anna@example.com",
        Reply.createReplyEl(undefined, "message-id1"),
        "ok",
        "chat",
        "Hi 👋\nsecond",
      );

      expect(message.getElementsByTagName("body")[0].textContent).toBe(
        "> Hi 👋\n> second\nok",
      );

      const region = message.getElementsByTagNameNS(
        Reply.FALLBACK_NS,
        "body",
      )[0];
      // 15 个码点 + 引用块后的换行；按 UTF-16 长度会多算 emoji 的代理对
      expect(region.getAttribute("end")).toBe("16");
    });
  });
});
