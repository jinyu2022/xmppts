import { describe, it, expect } from "vitest";
import { XMPPDateTime } from "../../../lib/plugins/xep0082/dateTime";

/**
 * XEP-0082: XMPP Date and Time Profiles
 * @see https://xmpp.org/extensions/xep-0082.html
 * @version 1.1.1 (2021-08-31)
 *
 * 用例取自 §3 规范示例（Example 1~4）；其余无示例的分支按各 profile 的词法规则补充。
 * 注: 格式化默认按 UTC 取数并输出 Z，传入偏移时先做真实换算；
 * 因此测试用 Date.UTC 构造输入，期望值不依赖运行机器时区。
 */
describe("XMPPDateTime", () => {
  describe("formatDate", () => {
    it("Example 1：格式化为 CCYY-MM-DD", () => {
      const date = new Date(Date.UTC(1776, 6, 4));
      expect(XMPPDateTime.formatDate(date)).toBe("1776-07-04");
    });

    it("个位月和日补零", () => {
      const date = new Date(Date.UTC(2025, 0, 15));
      expect(XMPPDateTime.formatDate(date)).toBe("2025-01-15");
    });

    it("正确格式化 12 月日期", () => {
      const date = new Date(Date.UTC(2024, 11, 25));
      expect(XMPPDateTime.formatDate(date)).toBe("2024-12-25");
    });

    it("小于 1000 的年份补零到四位", () => {
      const date = new Date(Date.UTC(999, 0, 15));
      expect(XMPPDateTime.formatDate(date)).toBe("0999-01-15");
    });

    it("保留负年份的符号", () => {
      const date = new Date(0);
      date.setUTCFullYear(-1, 0, 15);
      expect(XMPPDateTime.formatDate(date)).toBe("-0001-01-15");
    });

    it("无效 Date 抛错", () => {
      expect(() => XMPPDateTime.formatDate(new Date("invalid"))).toThrow(
        "无效的 Date 对象"
      );
    });
  });

  describe("formatDateTime", () => {
    it("Example 2：以 UTC 格式化为 CCYY-MM-DDThh:mm:ssZ", () => {
      const date = new Date(Date.UTC(1969, 6, 21, 2, 56, 15));
      expect(XMPPDateTime.formatDateTime(date)).toBe("1969-07-21T02:56:15Z");
    });

    it("Example 3：给定偏移时按当地时刻输出", () => {
      const date = new Date(Date.UTC(1969, 6, 21, 2, 56, 15));
      expect(XMPPDateTime.formatDateTime(date, false, "-05:00")).toBe(
        "1969-07-20T21:56:15-05:00"
      );
    });

    it("按需包含毫秒", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 14, 30, 0, 123));
      expect(XMPPDateTime.formatDateTime(date, true)).toBe(
        "2025-07-18T14:30:00.123Z"
      );
    });

    it("给定偏移时做真实时刻换算", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 12, 0, 0));
      expect(XMPPDateTime.formatDateTime(date, false, "+08:00")).toBe(
        "2025-07-18T20:00:00+08:00"
      );
    });

    it("零偏移归一化为 Z", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 12, 0, 0));
      expect(XMPPDateTime.formatDateTime(date, false, "+00:00")).toBe(
        "2025-07-18T12:00:00Z"
      );
      expect(XMPPDateTime.formatDateTime(date, false, "-00:00")).toBe(
        "2025-07-18T12:00:00Z"
      );
    });

    it("接受 XSD 最大偏移 +14:00，拒绝 +14:30", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 12, 0, 0));
      expect(XMPPDateTime.formatDateTime(date, false, "+14:00")).toBe(
        "2025-07-19T02:00:00+14:00"
      );
      expect(() =>
        XMPPDateTime.formatDateTime(date, false, "+14:30")
      ).toThrow("无效的时区格式");
    });

    it("时区格式非法时抛错", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 12, 0, 0));
      expect(() =>
        XMPPDateTime.formatDateTime(date, false, "invalid")
      ).toThrow("无效的时区格式");
    });

    it("无效 Date 抛错", () => {
      expect(() =>
        XMPPDateTime.formatDateTime(new Date("invalid"))
      ).toThrow("无效的 Date 对象");
    });
  });

  describe("formatTime", () => {
    it("Example 4：以 UTC 格式化为 hh:mm:ssZ", () => {
      const date = new Date(Date.UTC(1970, 0, 1, 16, 0, 0));
      expect(XMPPDateTime.formatTime(date)).toBe("16:00:00Z");
    });

    it("按需包含毫秒", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 9, 15, 30, 456));
      expect(XMPPDateTime.formatTime(date, true)).toBe("09:15:30.456Z");
    });

    it("给定偏移时做真实时刻换算", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 6, 30, 0));
      expect(XMPPDateTime.formatTime(date, false, "+05:30")).toBe(
        "12:00:00+05:30"
      );
    });

    it("零偏移归一化为 Z", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 9, 15, 30));
      expect(XMPPDateTime.formatTime(date, false, "+00:00")).toBe("09:15:30Z");
      expect(XMPPDateTime.formatTime(date, false, "-00:00")).toBe("09:15:30Z");
    });

    it("时区格式非法时抛错", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 12, 0, 0));
      expect(() => XMPPDateTime.formatTime(date, false, "UTC")).toThrow(
        "无效的时区格式"
      );
    });

    it("无效 Date 抛错", () => {
      expect(() => XMPPDateTime.formatTime(new Date("invalid"))).toThrow(
        "无效的 Date 对象"
      );
    });
  });

  describe("parseDateTime", () => {
    it("Example 2：按 UTC 解析 CCYY-MM-DDThh:mm:ssZ", () => {
      const result = XMPPDateTime.parseDateTime("1969-07-21T02:56:15Z");
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(Date.UTC(1969, 6, 21, 2, 56, 15));
    });

    it("Example 3：解析带负偏移的日期时间", () => {
      const result = XMPPDateTime.parseDateTime("1969-07-20T21:56:15-05:00");
      expect(result.getTime()).toBe(Date.UTC(1969, 6, 21, 2, 56, 15));
    });

    it("按 UTC 解析 CCYYMMDDThh:mm:ss 格式", () => {
      const result = XMPPDateTime.parseDateTime("20250718T14:30:00");
      expect(result.getTime()).toBe(Date.UTC(2025, 6, 18, 14, 30, 0));
    });

    it("应用时区偏移", () => {
      const result = XMPPDateTime.parseDateTime("2025-07-18T22:30:00+08:00");
      expect(result.getTime()).toBe(Date.UTC(2025, 6, 18, 14, 30, 0));
    });

    it("标准格式缺少 TZD 时抛错", () => {
      expect(() => XMPPDateTime.parseDateTime("2025-07-18T14:30:00")).toThrow(
        "无效的日期时间字符串"
      );
    });

    it("拒绝小写 z", () => {
      expect(() => XMPPDateTime.parseDateTime("2025-07-18T14:30:00z")).toThrow(
        "无效的日期时间字符串"
      );
    });

    it("字段越界时抛错（不回绕）", () => {
      expect(() => XMPPDateTime.parseDateTime("2025-13-01T00:00:00Z")).toThrow();
      expect(() => XMPPDateTime.parseDateTime("20241301T00:00:00")).toThrow();
      expect(() => XMPPDateTime.parseDateTime("2025-02-29T00:00:00Z")).toThrow();
      expect(() => XMPPDateTime.parseDateTime("2025-07-18T24:00:00Z")).toThrow();
      expect(() => XMPPDateTime.parseDateTime("2025-07-18T14:60:00Z")).toThrow();
    });

    it("接受闰年 2 月 29 日", () => {
      expect(XMPPDateTime.parseDateTime("2024-02-29T00:00:00Z").getTime()).toBe(
        Date.UTC(2024, 1, 29)
      );
    });

    it("按字面解析小于 100 的年份", () => {
      const result = XMPPDateTime.parseDateTime("0069-07-20T20:18:00Z");
      expect(result.getUTCFullYear()).toBe(69);
      expect(result.getUTCMonth()).toBe(6);
      expect(result.getUTCDate()).toBe(20);
    });

    it("截断亚毫秒小数而非回绕", () => {
      expect(
        XMPPDateTime.parseDateTime("2025-07-18T14:30:00.9999999Z").getTime()
      ).toBe(Date.UTC(2025, 6, 18, 14, 30, 0, 999));
    });

    it("亚毫秒截断无浮点误差", () => {
      expect(
        XMPPDateTime.parseDateTime("2025-07-18T14:30:00.505Z").getUTCMilliseconds()
      ).toBe(505);
    });

    it("与 formatDateTime 往返一致", () => {
      const date = new Date(Date.UTC(2025, 6, 18, 14, 30, 0, 123));
      expect(
        XMPPDateTime.parseDateTime(XMPPDateTime.formatDateTime(date, true)).getTime()
      ).toBe(date.getTime());
    });

    it("无法解析的字符串抛错", () => {
      expect(() => XMPPDateTime.parseDateTime("not-a-date")).toThrow();
    });

    it("空字符串抛错", () => {
      expect(() => XMPPDateTime.parseDateTime("")).toThrow();
    });
  });
});
