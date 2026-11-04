import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import OccupantId from "../../../lib/plugins/xep0421/occupantId";

/**
 * XEP-0421: Occupant identifiers for semi-anonymous MUCs
 * @see https://xmpp.org/extensions/xep-0421.html
 * @version 1.0.1 (2025-04-09)
 *
 * 用例取自 §3.1 Example 2/3 与 §6 XML Schema。
 */
describe("OccupantId", () => {
  describe("parseOccupantIdEl", () => {
    it("Example 2：解析房间分配的 occupant-id", () => {
      const el = Parser.parse(
        `<occupant-id xmlns="urn:xmpp:occupant-id:0" id="dd72603deec90a38ba552f7c68cbcc61bca202cd"/>`,
      );
      expect(OccupantId.parseOccupantIdEl(el)).toEqual({
        occupantID: { id: "dd72603deec90a38ba552f7c68cbcc61bca202cd" },
      });
    });

    it("缺少 id 时忽略该元素", () => {
      const el = Parser.parse(`<occupant-id xmlns="urn:xmpp:occupant-id:0"/>`);
      expect(OccupantId.parseOccupantIdEl(el)).toEqual({});
    });

    it("id 为空串时忽略该元素", () => {
      const el = Parser.parse(
        `<occupant-id xmlns="urn:xmpp:occupant-id:0" id=""/>`,
      );
      expect(OccupantId.parseOccupantIdEl(el)).toEqual({});
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(
        `<occupant-id xmlns="urn:xmpp:other" id="x"/>`,
      );
      expect(() => OccupantId.parseOccupantIdEl(el)).toThrow(
        "非法的 occupant-id 命名空间",
      );
    });

    it("未知元素名时忽略", () => {
      const el = Parser.parse(
        `<occupant xmlns="urn:xmpp:occupant-id:0" id="x"/>`,
      );
      expect(OccupantId.parseOccupantIdEl(el)).toEqual({});
    });
  });
});
