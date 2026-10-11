import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import type { XMPPElement } from "../../../lib/ltx/Element";
import Moderation from "../../../lib/plugins/xep0425/moderation";
import { Retraction } from "../../../lib/plugins/xep0424/retraction";

/** parseModeration 返回联合类型，按元素种类收窄以便逐字段断言 */
const asModerate = (el: XMPPElement) =>
  Moderation.parseModeration(el) as {
    moderate: { id?: string; reason?: string };
  };
const asModerated = (el: XMPPElement) =>
  Moderation.parseModeration(el) as {
    moderated: { by?: string };
  };

/**
 * XEP-0425: Moderated Message Retraction
 * @see https://xmpp.org/extensions/xep-0425.html
 * @version 0.3.0 (2023-03-02)
 *
 * 用例取自 §3 Example 4（审核者 IQ 中的 moderate）、§3.1 Example 5（在线审核通知）
 * 与 §4 Example 8（MAM 结果中的审核墓碑）。
 */
describe("Moderation (XEP0425)", () => {
  // §3 Example 4：审核者发出 IQ 中的 moderate 元素（含 retract 与 reason）
  const EXAMPLE_4_MODERATE = `
    <moderate id="stanza-id-1" xmlns="urn:xmpp:message-moderate:1">
      <retract xmlns="urn:xmpp:message-retract:1"/>
      <reason>This message contains inappropriate content for this forum</reason>
    </moderate>`;
  // §3.1 Example 5：MUC 发给所有参与者的审核通知
  const EXAMPLE_5_NOTICE = `
    <retract id="stanza-id-1" xmlns="urn:xmpp:message-retract:1">
      <moderated by="room@muc.example.com/macbeth" xmlns="urn:xmpp:message-moderate:1">
        <occupant-id xmlns="urn:xmpp:occupant-id:0" id="dd72603deec90a38ba552f7c68cbcc61bca202cd"/>
      </moderated>
      <reason>This message contains inappropriate content for this forum</reason>
    </retract>`;
  // §4 Example 8：MAM 结果里的审核墓碑
  const EXAMPLE_8_TOMBSTONE = `
    <retracted stamp="2019-09-20T23:19:12Z" xmlns="urn:xmpp:message-retract:1" id="retract-message-1">
      <moderated by="witch@shakespeare.example" xmlns="urn:xmpp:message-moderate:1">
        <occupant-id xmlns="urn:xmpp:occupant-id:0" id="dd72603deec90a38ba552f7c68cbcc61bca202cd"/>
      </moderated>
      <reason>This message contains inappropriate content for this forum</reason>
    </retracted>`;

  /** `<moderated/>` 嵌在 `<retract/>` / `<retracted/>` 内，模拟框架转交时取出的那个元素 */
  const pickModerated = (retractEl: XMPPElement) =>
    retractEl.getElementsByTagNameNS(Moderation.NS, "moderated")[0];

  describe("createModerationEl", () => {
    it("Example 4：生成带 id、retract 与 reason 的 moderate 元素", () => {
      const modEl = Moderation.createModerationEl(
        "stanza-id-1",
        "This message contains inappropriate content for this forum"
      );
      expect(modEl.tagName).toBe("moderate");
      expect(modEl.namespaceURI).toBe(Moderation.NS);
      expect(modEl.getAttribute("id")).toBe("stanza-id-1");
      const retractEl = modEl.getElementsByTagNameNS(Retraction.NS, "retract")[0];
      expect(retractEl).toBeDefined();
      expect(modEl.getElementsByTagName("reason")[0]?.textContent).toBe(
        "This message contains inappropriate content for this forum"
      );
    });
  });

  describe("parseModeration 解析 moderate", () => {
    it("Example 4：解析出 id 与 reason", () => {
      const el = Parser.parse(EXAMPLE_4_MODERATE);
      const result = asModerate(el);
      expect(result.moderate.id).toBe("stanza-id-1");
      expect(result.moderate.reason).toBe(
        "This message contains inappropriate content for this forum"
      );
    });

    it("缺少 id 时抛错", () => {
      const el = Parser.parse(
        `<moderate xmlns="urn:xmpp:message-moderate:1"><retract xmlns="urn:xmpp:message-retract:1"/></moderate>`
      );
      expect(() => Moderation.parseModeration(el)).toThrow("消息审核元素缺少 id");
    });

    it("缺少 retract 子元素时抛错", () => {
      const el = Parser.parse(`<moderate xmlns="urn:xmpp:message-moderate:1" id="s1"/>`);
      expect(() => Moderation.parseModeration(el)).toThrow(
        "消息审核元素缺少必需的 retract 子元素"
      );
    });
  });

  describe("parseModeration 解析 moderated", () => {
    it("Example 5：解析出审核者", () => {
      const result = asModerated(pickModerated(Parser.parse(EXAMPLE_5_NOTICE)));
      expect(result.moderated.by).toBe("room@muc.example.com/macbeth");
    });

    it("Example 8：墓碑里的 moderated 同样带出 by", () => {
      const result = asModerated(pickModerated(Parser.parse(EXAMPLE_8_TOMBSTONE)));
      expect(result.moderated.by).toBe("witch@shakespeare.example");
    });

    it("单独解析时忽略元素内的 occupant-id", () => {
      const el = Parser.parse(
        `<moderated by="witch@shakespeare.example" xmlns="urn:xmpp:message-moderate:1">
          <occupant-id xmlns="urn:xmpp:occupant-id:0" id="dd72603deec90a38ba552f7c68cbcc61bca202cd"/>
        </moderated>`
      );
      expect(asModerated(el).moderated.by).toBe("witch@shakespeare.example");
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(`<moderated xmlns="urn:xmpp:other"/>`);
      expect(() => Moderation.parseModeration(el)).toThrow("非法命名空间");
    });

    it("未知标签时抛错", () => {
      const el = Parser.parse(`<unknown xmlns="urn:xmpp:message-moderate:1"/>`);
      expect(() => Moderation.parseModeration(el)).toThrow("未知的消息审核元素标签");
    });
  });

  describe("createModeratedEl", () => {
    it("Example 8：生成带 by 的 moderated 元素，reason 不放进元素内", () => {
      const el = Moderation.createModeratedEl("witch@shakespeare.example");
      expect(el.tagName).toBe("moderated");
      expect(el.namespaceURI).toBe(Moderation.NS);
      expect(el.getAttribute("by")).toBe("witch@shakespeare.example");
      expect(el.getElementsByTagName("reason")).toHaveLength(0);
    });

    it("不传 by 时省略 by 属性（§4）", () => {
      const el = Moderation.createModeratedEl();
      expect(el.getAttribute("by")).toBeNull();
    });
  });

  describe("往返一致性", () => {
    it("createModerationEl 产物可被解析回原值", () => {
      const parsed = asModerate(Moderation.createModerationEl("s1", "reason"));
      expect(parsed.moderate.id).toBe("s1");
      expect(parsed.moderate.reason).toBe("reason");
    });

    it("createModeratedEl 产物放进 retracted 后可被解析回原值", () => {
      const retracted = Parser.parse(
        `<retracted id="m1" xmlns="urn:xmpp:message-retract:1"/>`
      );
      retracted.appendChild(Moderation.createModeratedEl("mod@muc.example/res"));
      const parsed = asModerated(pickModerated(retracted));
      expect(parsed.moderated.by).toBe("mod@muc.example/res");
    });
  });
});
