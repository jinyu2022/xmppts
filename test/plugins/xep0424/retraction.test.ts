import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import type { XMPPElement } from "../../../lib/ltx/Element";
import Retraction from "../../../lib/plugins/xep0424/retraction";

/**
 * XEP-0424: Message Retraction
 * @see https://xmpp.org/extensions/xep-0424.html
 * @version 0.5.0 (2026-07-03)
 *
 * 用例取自 §3 Example 5（客户端发出撤回）与 §4 Example 8（服务端回填 tombstone）。
 */
describe("Retraction", () => {
  // §3 Example 5：客户端发出的撤回元素
  const EXAMPLE_5_RETRACT = `<retract id="wrong-recipient-1" xmlns="urn:xmpp:message-retract:1"/>`;
  // §4 Example 8：MAM 结果中的 tombstone
  const EXAMPLE_8_RETRACTED = `<retracted stamp="2019-09-20T23:09:32Z" xmlns="urn:xmpp:message-retract:1" id="retract-message-1"/>`;

  describe("createRetractionEl", () => {
    it("Example 5：生成带 id 与命名空间的 retract 元素", () => {
      const retract = Retraction.createRetractionEl("wrong-recipient-1");
      expect(retract.tagName).toBe("retract");
      expect(retract.namespaceURI).toBe(Retraction.NS);
      expect(retract.getAttribute("id")).toBe("wrong-recipient-1");
    });
  });

  describe("parseRetractionEl", () => {
    it("Example 5：解析 retract 元素", () => {
      const retract = Parser.parse(EXAMPLE_5_RETRACT);
      expect(Retraction.parseRetractionEl(retract)).toEqual({
        retract: { id: "wrong-recipient-1" },
      });
    });

    it("Example 8：解析带 stamp 的 tombstone", () => {
      const retracted = Parser.parse(EXAMPLE_8_RETRACTED);
      const result = Retraction.parseRetractionEl(retracted) as {
        retracted: { id: string; stamp?: Date };
      };
      expect(result.retracted.id).toBe("retract-message-1");
      expect(result.retracted.stamp).toEqual(new Date("2019-09-20T23:09:32Z"));
    });

    it("stamp 非法时抛错", () => {
      const retracted = Parser.parse(
        `<retracted xmlns="urn:xmpp:message-retract:1" id="m1" stamp="not-a-date"/>`
      );
      expect(() => Retraction.parseRetractionEl(retracted)).toThrow(
        "不是合法的 dateTime"
      );
    });

    it("XEP0425 通知：reason 与其它命名空间的子元素一并保留", () => {
      const retract = Parser.parse(`
        <retract id="stanza-id-1" xmlns="urn:xmpp:message-retract:1">
          <moderated by="room@muc.example.com/macbeth" xmlns="urn:xmpp:message-moderate:1"/>
          <reason>This message contains inappropriate content for this forum</reason>
        </retract>`);
      const result = Retraction.parseRetractionEl(retract) as {
        retract: { id: string; reason?: string };
        moderated?: XMPPElement;
      };
      expect(result.retract.id).toBe("stanza-id-1");
      expect(result.retract.reason).toBe(
        "This message contains inappropriate content for this forum"
      );
      // <moderated/> 不属于 XEP0424，原样转交给框架按命名空间继续转换
      expect(result.moderated?.localName).toBe("moderated");
      expect(result.moderated?.getAttribute("by")).toBe("room@muc.example.com/macbeth");
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(`<retract xmlns="urn:xmpp:other" id="m1"/>`);
      expect(() => Retraction.parseRetractionEl(el)).toThrow("非法命名空间");
    });

    it("缺少 id 时抛错", () => {
      const el = Parser.parse(`<retract xmlns="urn:xmpp:message-retract:1"/>`);
      expect(() => Retraction.parseRetractionEl(el)).toThrow("缺少 id");
    });
  });

  describe("createRetractionMessage", () => {
    it("Example 5：生成携带 retract 与回退 body 的消息", () => {
      const message = Retraction.createRetractionMessage(
        "lord@capulet.example",
        "wrong-recipient-1",
        "chat",
        "/me retracted a previous message, but it's unsupported by your client."
      );
      expect(message.tagName).toBe("message");
      expect(message.getAttribute("to")).toBe("lord@capulet.example");
      expect(message.getAttribute("type")).toBe("chat");
      expect(message.getElementsByTagName("body")[0]?.textContent).toBe(
        "/me retracted a previous message, but it's unsupported by your client."
      );
      const retract = message.getElementsByTagName("retract")[0];
      expect(retract.getAttribute("id")).toBe("wrong-recipient-1");
      expect(retract.namespaceURI).toBe(Retraction.NS);
    });
  });
});
