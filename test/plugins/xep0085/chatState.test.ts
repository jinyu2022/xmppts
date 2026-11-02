import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import ChatState from "../../../lib/plugins/xep0085/chatState";

/**
 * XEP-0085: Chat State Notifications
 * @see https://xmpp.org/extensions/xep-0085.html
 * @version 2.1 (2009-09-23)
 *
 * 用例取自 §4 的状态定义与 §6 的示例。
 */
describe("ChatState", () => {
  describe("parseChatStateEl", () => {
    it("解析规范定义的全部状态", () => {
      for (const state of ChatState.STATES) {
        const el = Parser.parse(`<${state} xmlns="${ChatState.NS}"/>`);
        expect(ChatState.parseChatStateEl(el)).toEqual({ chatState: state });
      }
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(`<composing xmlns="urn:xmpp:other"/>`);
      expect(() => ChatState.parseChatStateEl(el)).toThrow(
        "非法的聊天状态命名空间",
      );
    });

    it("忽略未知状态名", () => {
      const el = Parser.parse(`<typing xmlns="${ChatState.NS}"/>`);
      expect(ChatState.parseChatStateEl(el)).toEqual({});
    });
  });

  describe("createChatStateEl", () => {
    it("拒绝规范之外的状态", () => {
      expect(() =>
        ChatState.createChatStateEl("typing" as unknown as "active"),
      ).toThrow("未知的聊天状态");
    });
  });

  describe("createChatStateMessage", () => {
    it("生成只含状态元素的消息", () => {
      const message = ChatState.createChatStateMessage(
        "romeo@montague.lit",
        "composing",
      );
      expect(message.getAttribute("to")).toBe("romeo@montague.lit");
      expect(message.getAttribute("type")).toBe("chat");
      expect(message.getElementsByTagName("body")).toHaveLength(0);

      const state = message.getElementsByTagName("composing")[0];
      expect(state.namespaceURI).toBe(ChatState.NS);
    });

    it("群聊状态使用 groupchat 类型", () => {
      const message = ChatState.createChatStateMessage(
        "coven@chat.shakespeare.lit",
        "active",
        "groupchat",
      );
      expect(message.getAttribute("type")).toBe("groupchat");
    });
  });
});
