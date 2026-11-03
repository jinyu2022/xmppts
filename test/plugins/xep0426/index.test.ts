import { describe, expect, it } from "vitest";
import { XEP0426 } from "../../../lib/plugins/xep0426";

/**
 * XEP-0426: Character counting in message bodies
 * @see https://xmpp.org/extensions/xep-0426.html
 */
describe("XEP0426.length", () => {
    // 用例取自规范 §2 的对照表（码点列）
    it.each([
        ["Hello, world!", 13],
        ["You & Me", 8],
        ["こんにちは世界", 7],
        ["🧛🏾 👨‍👨‍👦‍👦 🇺🇳", 13],
    ])("按码点统计 %s", (text, expected) => {
        expect(XEP0426.length(text)).toBe(expected);
    });

    it("代理对只算一个码点", () => {
        expect("😀".length).toBe(2);
        expect(XEP0426.length("😀")).toBe(1);
    });

    it("组合字符按码点计，不合并为字素簇", () => {
        expect(XEP0426.length("e\u0301")).toBe(2);
    });
});

describe("XEP0426.toUtf16Index", () => {
    it("按码点跳转，代理对占两个码元", () => {
        const text = "a😀b";
        expect(XEP0426.toUtf16Index(text, 0)).toBe(0);
        expect(XEP0426.toUtf16Index(text, 1)).toBe(1);
        expect(XEP0426.toUtf16Index(text, 2)).toBe(3);
        expect(XEP0426.toUtf16Index(text, 3)).toBe(4);
    });

    it("偏移超出长度时返回末尾索引", () => {
        expect(XEP0426.toUtf16Index("a😀", 5)).toBe(3);
    });
});

describe("XEP0426.toCodePointOffset", () => {
    it("把 UTF-16 索引换算为码点偏移", () => {
        const text = "a😀b";
        expect(XEP0426.toCodePointOffset(text, 0)).toBe(0);
        expect(XEP0426.toCodePointOffset(text, 1)).toBe(1);
        expect(XEP0426.toCodePointOffset(text, 3)).toBe(2);
        expect(XEP0426.toCodePointOffset(text, 4)).toBe(3);
    });

    it("落在代理对中间时向上取整到码点边界", () => {
        expect(XEP0426.toCodePointOffset("a😀b", 2)).toBe(2);
    });

    it("索引超出长度时返回码点总数", () => {
        expect(XEP0426.toCodePointOffset("a😀", 5)).toBe(2);
    });
});
