import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import Markers from "../../../lib/plugins/xep0333/markers";

/**
 * XEP-0333: Displayed Markers
 * @see https://xmpp.org/extensions/xep-0333.html
 * @version 1.0.0 (2024-04-17)
 *
 * 用例取自 §4.1 与 §4.2 的示例。
 */
describe("Markers", () => {
  const EXAMPLE_MARKABLE = `<markable xmlns="urn:xmpp:chat-markers:0"/>`;
  const EXAMPLE_DISPLAYED = `<displayed xmlns="urn:xmpp:chat-markers:0" id="the-msg-1"/>`;

  describe("parseMarkerEl", () => {
    it("解析 §4.1 示例的 markable", () => {
      const markable = Parser.parse(EXAMPLE_MARKABLE);
      expect(Markers.parseMarkerEl(markable)).toEqual({ markable: true });
    });

    it("解析 §4.2 示例的 displayed 引用 ID", () => {
      const displayed = Parser.parse(EXAMPLE_DISPLAYED);
      expect(Markers.parseMarkerEl(displayed)).toEqual({
        displayed: { id: "the-msg-1" },
      });
    });

    it("displayed 缺少 id 时忽略该元素", () => {
      const displayed = Parser.parse(
        `<displayed xmlns="urn:xmpp:chat-markers:0"/>`,
      );
      expect(Markers.parseMarkerEl(displayed)).toEqual({});
    });

    it("忽略旧版 received 等未知元素", () => {
      const el = Parser.parse(
        `<received xmlns="urn:xmpp:chat-markers:0" id="m1"/>`,
      );
      // 早期草案的元素不应影响整条消息的解析
      expect(Markers.parseMarkerEl(el)).toEqual({});
    });

    it("命名空间不符时抛错", () => {
      const el = Parser.parse(`<displayed xmlns="urn:example:wrong" id="m1"/>`);
      expect(() => Markers.parseMarkerEl(el)).toThrow("不是一个标记元素");
    });
  });

  describe("createMarkableEl", () => {
    it("生成带命名空间的空元素", () => {
      const markable = Markers.createMarkableEl();
      expect(markable.tagName).toBe("markable");
      expect(markable.namespaceURI).toBe(Markers.NS);
      expect(markable.children).toHaveLength(0);
    });
  });

  describe("createDisplayedEl", () => {
    it("生成带 id 的 displayed 元素", () => {
      const displayed = Markers.createDisplayedEl("the-msg-1");
      expect(displayed.tagName).toBe("displayed");
      expect(displayed.namespaceURI).toBe(Markers.NS);
      expect(displayed.getAttribute("id")).toBe("the-msg-1");
    });

    it("id 为空时抛错", () => {
      expect(() => Markers.createDisplayedEl("")).toThrow(
        "已显示标记的 id 不能为空",
      );
    });
  });

  describe("createDisplayedMessage", () => {
    it("生成只含 displayed 的消息，不带 body", () => {
      const message = Markers.createDisplayedMessage(
        "romeo@montague.lit",
        "the-msg-1",
        "chat",
      );
      expect(message.tagName).toBe("message");
      expect(message.getAttribute("to")).toBe("romeo@montague.lit");
      expect(message.getAttribute("type")).toBe("chat");
      expect(message.getElementsByTagName("body")).toHaveLength(0);

      const displayed = message.getElementsByTagName("displayed")[0];
      expect(displayed.namespaceURI).toBe(Markers.NS);
      expect(displayed.getAttribute("id")).toBe("the-msg-1");
    });

    it("群聊标记使用 groupchat 类型", () => {
      const message = Markers.createDisplayedMessage(
        "coven@chat.shakespeare.lit",
        "39K7ZYIp",
        "groupchat",
      );
      expect(message.getAttribute("type")).toBe("groupchat");
    });
  });
});
