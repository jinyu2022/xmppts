import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import Reactions from "../../../lib/plugins/xep0444/reactions";

/**
 * XEP-0444: Message Reactions
 * @see https://xmpp.org/extensions/xep-0444.html
 * @version 0.2.1 (2024-04-15)
 *
 * 用例取自 §3.1/§3.2 示例与 §4 Business Rules。
 */
describe("Reactions", () => {
  const EXAMPLE_REACTIONS = `
    <reactions id="744f6e18-a57a-11e9-a656-4889e7820c76" xmlns="urn:xmpp:reactions:0">
      <reaction>👋</reaction>
      <reaction>🐢</reaction>
    </reactions>`;

  describe("parseReactionsEl", () => {
    it("Example 4：解析反应集合", () => {
      const reactions = Parser.parse(EXAMPLE_REACTIONS);
      expect(Reactions.parseReactionsEl(reactions)).toEqual({
        reactions: {
          id: "744f6e18-a57a-11e9-a656-4889e7820c76",
          values: ["👋", "🐢"],
        },
      });
    });

    it("空 reactions 解析为空数组（表示移除全部反应）", () => {
      const reactions = Parser.parse(
        `<reactions id="m1" xmlns="urn:xmpp:reactions:0"/>`,
      );
      expect(Reactions.parseReactionsEl(reactions)).toEqual({
        reactions: { id: "m1", values: [] },
      });
    });

    it("忽略重复反应、空反应与其它命名空间的子元素", () => {
      const reactions = Parser.parse(`
        <reactions id="m1" xmlns="urn:xmpp:reactions:0">
          <reaction>👋</reaction>
          <reaction>👋</reaction>
          <reaction/>
          <other xmlns="urn:xmpp:other">x</other>
        </reactions>`);
      expect(Reactions.parseReactionsEl(reactions)).toEqual({
        reactions: { id: "m1", values: ["👋"] },
      });
    });

    it("缺少 id 时忽略该元素", () => {
      const reactions = Parser.parse(
        `<reactions xmlns="urn:xmpp:reactions:0"><reaction>👋</reaction></reactions>`,
      );
      expect(Reactions.parseReactionsEl(reactions)).toEqual({});
    });

    it("命名空间不符时抛错", () => {
      const reactions = Parser.parse(
        `<reactions xmlns="urn:example:wrong" id="m1"/>`,
      );
      expect(() => Reactions.parseReactionsEl(reactions)).toThrow(
        "不是一个 reactions 元素",
      );
    });

  });

  describe("createReactionsEl", () => {
    it("生成 reactions 与去重后的 reaction 子元素", () => {
      const reactions = Reactions.createReactionsEl("m1", ["👋", "", "🐢", "👋"]);
      expect(reactions.tagName).toBe("reactions");
      expect(reactions.namespaceURI).toBe(Reactions.NS);
      expect(reactions.getAttribute("id")).toBe("m1");

      const values = Array.from(reactions.getElementsByTagName("reaction")).map(
        (reaction) => reaction.textContent,
      );
      expect(values).toEqual(["👋", "🐢"]);
    });

    it("空集合生成空的 reactions 元素", () => {
      const reactions = Reactions.createReactionsEl("m1", []);
      expect(reactions.children).toHaveLength(0);
    });
  });

  describe("createReactionsMessage", () => {
    it("Example 3：生成带 reactions 与 store 提示的消息", () => {
      const message = Reactions.createReactionsMessage(
        "romeo@capulet.net/orchard",
        "744f6e18-a57a-11e9-a656-4889e7820c76",
        ["👋"],
        "chat",
      );
      expect(message.getAttribute("to")).toBe("romeo@capulet.net/orchard");
      expect(message.getAttribute("type")).toBe("chat");

      const reactions = message.getElementsByTagName("reactions")[0];
      expect(reactions.getAttribute("id")).toBe(
        "744f6e18-a57a-11e9-a656-4889e7820c76",
      );

      const store = message.getElementsByTagNameNS(
        Reactions.HINTS_NS,
        "store",
      )[0];
      expect(store).toBeTruthy();
    });

    it("store=false 时不附加 store 提示", () => {
      const message = Reactions.createReactionsMessage(
        "romeo@capulet.net/orchard",
        "m1",
        ["👋"],
        "chat",
        false,
      );
      expect(
        message.getElementsByTagNameNS(Reactions.HINTS_NS, "store"),
      ).toHaveLength(0);
    });
  });
});
