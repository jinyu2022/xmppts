import { describe, it, expect } from "vitest";
import { Nickname } from "../../../lib/plugins/xep0172/nickname";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0172: User Nickname
 * @see https://xmpp.org/extensions/xep-0172.html
 * @version 1.1 (2012-03-21)
 *
 * 用例取自 §3 Format 与 §4 Use Cases 的规范示例：Example 1 解析 nick，
 * Example 3/4/5 测构造，Example 9 测从消息中解析。
 */
describe("Nickname", () => {
  describe("parseNickEl", () => {
    it("Example 1：解析 nick 元素", () => {
      const el = Parser.parse(
        `<nick xmlns="http://jabber.org/protocol/nick">Ishmael</nick>`
      );
      expect(Nickname.parseNickEl(el)).toEqual({ nick: "Ishmael" });
    });

    it("Example 9：从消息中取出 nick 元素解析", () => {
      const msg = Parser.parse(`
        <message from="narrator@moby-dick.lit/pda" to="starbuck@moby-dick.lit">
          <nick xmlns="http://jabber.org/protocol/nick">CallMeIshmael</nick>
        </message>
      `);
      expect(Nickname.parseNickEl(msg.getElementsByTagName("nick")[0])).toEqual({
        nick: "CallMeIshmael",
      });
    });

    it("命名空间非法时抛错", () => {
      const el = XMPPElement.createElementNS("urn:invalid", "nick");
      el.textContent = "Test";
      expect(() => Nickname.parseNickEl(el)).toThrow("不是一个nick元素");
    });
  });

  describe("createNickSubscribe", () => {
    it("Example 3：生成带 nick 的订阅 presence", () => {
      const pres = Nickname.createNickSubscribe("starbuck@moby-dick.lit", "Ishmael");
      const nickEl = pres.getElementsByTagName("nick")[0];
      expect(pres.tagName).toBe("presence");
      expect(pres.getAttribute("to")).toBe("starbuck@moby-dick.lit");
      expect(pres.getAttribute("type")).toBe("subscribe");
      expect(nickEl.namespaceURI).toBe(Nickname.NS);
      expect(nickEl.textContent).toBe("Ishmael");
    });

    it("RFC 6121 §3.1.1：订阅目标使用 bare JID", () => {
      const pres = Nickname.createNickSubscribe("starbuck@moby-dick.lit/bridge", "Ishmael");

      expect(pres.getAttribute("to")).toBe("starbuck@moby-dick.lit");
      expect(pres.getAttribute("type")).toBe("subscribe");
      expect(pres.getElementsByTagNameNS(Nickname.NS, "nick")[0].textContent).toBe("Ishmael");
    });

    it("拒绝无效的订阅目标", () => {
      expect(() => Nickname.createNickSubscribe("user@", "Ishmael")).toThrow("无效的 JID 格式");
    });
  });

  describe("createNickMessage", () => {
    it("Example 4：生成带 body 与 nick 的 chat 消息", () => {
      const msg = Nickname.createNickMessage(
        "starbuck@moby-dick.lit",
        "Call me Ishmael",
        "Ishmael"
      );
      const nickEl = msg.getElementsByTagName("nick")[0];
      expect(msg.tagName).toBe("message");
      expect(msg.getAttribute("to")).toBe("starbuck@moby-dick.lit");
      expect(msg.getAttribute("type")).toBe("chat");
      expect(msg.getElementsByTagName("body")[0]?.textContent).toBe("Call me Ishmael");
      expect(nickEl.namespaceURI).toBe(Nickname.NS);
      expect(nickEl.textContent).toBe("Ishmael");
    });
  });

  describe("createNickPublishIq", () => {
    it("Example 5：生成 PEP 发布 IQ（pubsub/publish/item/nick）", () => {
      const iq = Nickname.createNickPublishIq("CallMeIshmael");
      const publish = iq.getElementsByTagName("publish")[0];
      const nickEl = iq.getElementsByTagNameNS(Nickname.NS, "nick")[0];
      expect(iq.tagName).toBe("iq");
      expect(iq.getAttribute("type")).toBe("set");
      expect(iq.getElementsByTagName("iq")).toHaveLength(0);
      expect(publish.getAttribute("node")).toBe(Nickname.NS);
      expect(nickEl.textContent).toBe("CallMeIshmael");
    });
  });

  describe("createRetrieveNickIq", () => {
    it("生成 PEP 检索 IQ", () => {
      const iq = Nickname.createRetrieveNickIq("narrator@moby-dick.lit");
      expect(iq.tagName).toBe("iq");
      expect(iq.getAttribute("type")).toBe("get");
    });
  });
});
