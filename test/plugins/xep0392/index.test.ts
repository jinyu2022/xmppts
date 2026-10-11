import { describe, it, expect } from "vitest";
import { XEP0392 } from "../../../lib/plugins/xep0392";
import { JID } from "../../../lib/JID";

/**
 * XEP-0392: Consistent Color Generation
 * @see https://xmpp.org/extensions/xep-0392.html
 * @version 1.0.1 (2025-10-03)
 *
 * 用例取自 §13.1 Test Vectors（saturation=100、lightness=50 的 RGB 值 → hex）。
 */
describe("XEP0392", () => {
  /** §13.1 测试向量：文本与对应的 #rrggbb（由向量 RGB 四舍五入到 0-255） */
  const VECTORS: [string, string][] = [
    ["Romeo", "#dd00af"],
    ["juliet@capulet.lit", "#008392"],
    ["😺", "#de00a8"],
    ["council", "#ea0064"],
    ["Board", "#008675"],
  ];

  describe("colorize", () => {
    it.each(VECTORS)("§13.1 '%s' → %s", async (input, expected) => {
      XEP0392.cache.clear();
      expect(await XEP0392.colorize(input)).toBe(expected);
    });

    it("同一输入颜色一致且写入缓存", async () => {
      XEP0392.cache.clear();
      const input = "juliet@capulet.lit";
      const color = await XEP0392.colorize(input);
      expect(await XEP0392.colorize(input)).toBe(color);
      expect(XEP0392.cache.get(input)).toBe(color);
    });

    it.each(VECTORS)("返回合法 #rrggbb", async (input) => {
      expect(await XEP0392.colorize(input)).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe("colorizeJID", () => {
    it("localpart/domainpart 大小写等价的 JID 得到同一颜色（§6.2）", async () => {
      XEP0392.cache.clear();
      expect(await XEP0392.colorizeJID(new JID("Romeo@Example.COM"))).toBe(
        await XEP0392.colorizeJID(new JID("romeo@example.com"))
      );
    });

    it("resourcepart 大小写敏感，视为不同 JID", async () => {
      XEP0392.cache.clear();
      expect(await XEP0392.colorizeJID(new JID("romeo@example.com/Cat"))).not.toBe(
        await XEP0392.colorizeJID(new JID("romeo@example.com/cat"))
      );
    });

    it("已规范化的 JID 与 §13.1 向量一致", async () => {
      XEP0392.cache.clear();
      expect(await XEP0392.colorizeJID(new JID("juliet@capulet.lit"))).toBe("#008392");
    });
  });

  describe("cache", () => {
    it("超过上限时按写入顺序淘汰最旧条目", async () => {
      XEP0392.cache.clear();
      const overflow = 2;
      for (let i = 0; i < XEP0392.MAX_CACHE_SIZE + overflow; i++) {
        await XEP0392.colorize(`user-${i}`);
      }
      expect(XEP0392.cache.size).toBe(XEP0392.MAX_CACHE_SIZE);
      expect(XEP0392.cache.has("user-0")).toBe(false);
      expect(XEP0392.cache.has("user-1")).toBe(false);
      expect(XEP0392.cache.has("user-2")).toBe(true);
    });
  });
});
