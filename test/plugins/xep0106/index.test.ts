import { describe, expect, it } from "vitest";
import { XEP0106 } from "../../../lib/plugins/xep0106";

/**
 * XEP-0106: JID Escaping
 * @see https://xmpp.org/extensions/xep-0106.html
 * @version 1.1.1 (2016-07-08)
 *
 * 用例取自 §5.1 Table 3（用户输入 ↔ 线上转义形式）与 §4.3 Exceptions（无效转义序列）。
 */
describe("XEP0106", () => {
  /** §5.1 Table 3：[用户输入（展示形式）, 线上转义形式] */
  const TABLE_3: Array<[string, string]> = [
    ["space cadet", String.raw`space\20cadet`],
    [`call me "ishmael"`, String.raw`call\20me\20\22ishmael\22`],
    ["at&t guy", String.raw`at\26t\20guy`],
    ["d'artagnan", String.raw`d\27artagnan`],
    ["/.fanboy", String.raw`\2f.fanboy`],
    ["::foo::", String.raw`\3a\3afoo\3a\3a`],
    ["<foo>", String.raw`\3cfoo\3e`],
    ["user@host", String.raw`user\40host`],
    [String.raw`c:\net`, String.raw`c\3a\5cnet`],
    [String.raw`c:\\net`, String.raw`c\3a\5c\5cnet`],
    [String.raw`c:\cool stuff`, String.raw`c\3a\5ccool\20stuff`],
    [String.raw`c:\5commas`, String.raw`c\3a\5c5commas`],
  ];

  describe("escapeLocal（§3.2 / §5.1）", () => {
    for (const [plain, escaped] of TABLE_3) {
      it(`${JSON.stringify(plain)} → ${JSON.stringify(escaped)}`, () => {
        expect(XEP0106.escapeLocal(plain)).toBe(escaped);
      });
    }

    it("首尾空白被去除（§4.1 第 6 条不允许 \\20 位于首尾）", () => {
      expect(XEP0106.escapeLocal("  space cadet  ")).toBe(
        String.raw`space\20cadet`,
      );
    });

    it("无禁止字符时原样返回", () => {
      expect(XEP0106.escapeLocal("somenick")).toBe("somenick");
      expect(XEP0106.escapeLocal("")).toBe("");
    });
  });

  describe("unescapeLocal（§3.3 / §5.1）", () => {
    for (const [plain, escaped] of TABLE_3) {
      it(`${JSON.stringify(escaped)} → ${JSON.stringify(plain)}`, () => {
        expect(XEP0106.unescapeLocal(escaped)).toBe(plain);
      });
    }

    it("\\5c 最后处理：\\5c20 还原为 \\20 而非空格", () => {
      expect(XEP0106.unescapeLocal(String.raw`space\5c20cadet`)).toBe(
        String.raw`space\20cadet`,
      );
    });
  });

  describe("detect", () => {
    for (const [plain, escaped] of TABLE_3) {
      it(`转义形式视为已转义：${JSON.stringify(escaped)}`, () => {
        expect(XEP0106.detect(escaped)).toBe(false);
      });
      it(`展示形式需要转义：${JSON.stringify(plain)}`, () => {
        expect(XEP0106.detect(plain)).toBe(true);
      });
    }

    it("空串与无禁止字符时返回 false", () => {
      expect(XEP0106.detect("")).toBe(false);
      expect(XEP0106.detect("somenick")).toBe(false);
    });
  });

  describe("§4.3 Exceptions：无效转义序列原样保留", () => {
    const UNCHANGED = [
      String.raw`\2plus\2is\4`, // 部分转义序列
      String.raw`foo\bar`, // 非法转义序列
      String.raw`foo\41r`, // 非禁止字符的转义序列
    ];

    for (const local of UNCHANGED) {
      it(`${JSON.stringify(local)} 反转义后不变`, () => {
        expect(XEP0106.unescapeLocal(local)).toBe(local);
      });
    }
  });
});
