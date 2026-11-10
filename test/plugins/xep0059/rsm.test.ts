import { describe, expect, it, vi } from "vitest";
import logger from "../../../lib/log";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import { RSM } from "../../../lib/plugins/xep0059/rsm";

/**
 * XEP-0059: Result Set Management
 * @see https://xmpp.org/extensions/xep-0059.html
 * @version 1.0 (2006-09-20)
 *
 * 请求构造按 §2 各用例；响应解析按 §2.2 的返回示例与 §3 的 disco 示例。
 */
describe("RSM", () => {
    describe("createSetEl", () => {
        it("§2.1：max 限制返回条数", () => {
            const set = RSM.createSetEl({ max: 10 });
            expect(set.tagName).toBe("set");
            expect(set.namespaceURI).toBe(RSM.NS);
            expect(set.getElementsByTagName("max")[0].textContent).toBe("10");
            expect(set.children).toHaveLength(1);
        });

        it("§2.2：after 取该 UID 之后的一页", () => {
            const set = RSM.createSetEl({
                max: 10,
                after: "peterpan@neverland.lit",
            });
            expect(set.getElementsByTagName("after")[0].textContent).toBe(
                "peterpan@neverland.lit",
            );
        });

        it("§2.3：before 取该 UID 之前的一页", () => {
            const set = RSM.createSetEl({
                max: 10,
                before: "peter@pixyland.org",
            });
            expect(set.getElementsByTagName("before")[0].textContent).toBe(
                "peter@pixyland.org",
            );
        });

        it("§2.4：空串 before 生成空的 <before/>，表示最后一页", () => {
            const set = RSM.createSetEl({ max: 10, before: "" });
            const before = set.getElementsByTagName("before")[0];
            expect(before).toBeDefined();
            expect(before.textContent).toBe("");
        });

        it("§2.5：index 从指定位置取页", () => {
            const set = RSM.createSetEl({ max: 10, index: 371 });
            expect(set.getElementsByTagName("index")[0].textContent).toBe("371");
        });

        it("§2.6：max 为 0 时只取条数", () => {
            const set = RSM.createSetEl({ max: 0 });
            expect(set.getElementsByTagName("max")[0].textContent).toBe("0");
        });

        it("无参数时生成空 set", () => {
            const set = RSM.createSetEl({});
            expect(set.children).toHaveLength(0);
        });
    });

    describe("parseSetEl", () => {
        it("§2.2 示例：解析 first/last/count 与 first 的 index", () => {
            const xml = Parser.parse(`
                <set xmlns="http://jabber.org/protocol/rsm">
                  <first index="0">stpeter@jabber.org</first>
                  <last>peterpan@neverland.lit</last>
                  <count>800</count>
                </set>
            `);
            const { rsm } = RSM.parseSetEl(xml);
            expect(rsm.first).toEqual({
                value: "stpeter@jabber.org",
                index: 0,
            });
            expect(rsm.last).toBe("peterpan@neverland.lit");
            expect(rsm.count).toBe(800);
        });

        it("§2.2：first 缺少 index 属性时只给 value", () => {
            const xml = Parser.parse(`
                <set xmlns="http://jabber.org/protocol/rsm">
                  <first>uid-1</first>
                </set>
            `);
            expect(RSM.parseSetEl(xml).rsm.first).toEqual({ value: "uid-1" });
        });

        it("§2.2：空页只带 count", () => {
            const xml = Parser.parse(`
                <set xmlns="http://jabber.org/protocol/rsm">
                  <count>790</count>
                </set>
            `);
            expect(RSM.parseSetEl(xml).rsm).toEqual({ count: 790 });
        });

        it("可传入直接包含 set 的父元素", () => {
            const xml = Parser.parse(`
                <fin xmlns="urn:xmpp:mam:2">
                  <set xmlns="http://jabber.org/protocol/rsm">
                    <last>09af3-cc343-b409f</last>
                  </set>
                </fin>
            `);
            expect(RSM.parseSetEl(xml).rsm.last).toBe("09af3-cc343-b409f");
        });

        it.each(["", "abc", "-5", "1.5"])(
            "§2.2：count 为 %j 时省略该字段",
            (content) => {
                const xml = Parser.parse(`
                    <set xmlns="http://jabber.org/protocol/rsm">
                      <count>${content}</count>
                    </set>
                `);
                expect(RSM.parseSetEl(xml).rsm).toEqual({});
            },
        );

        it.each(["", "abc", "-1"])(
            "§2.2：first 的 index 为 %j 时只给 value",
            (index) => {
                const xml = Parser.parse(`
                    <set xmlns="http://jabber.org/protocol/rsm">
                      <first index="${index}">uid-1</first>
                    </set>
                `);
                expect(RSM.parseSetEl(xml).rsm.first).toEqual({
                    value: "uid-1",
                });
            },
        );

        it("§2.7：count 为 0 时保留", () => {
            const xml = Parser.parse(`
                <set xmlns="http://jabber.org/protocol/rsm">
                  <count>0</count>
                </set>
            `);
            expect(RSM.parseSetEl(xml).rsm).toEqual({ count: 0 });
        });

        it("非法 count 记 warn，便于排查服务端问题", () => {
            const warn = vi
                .spyOn(logger.getLogger("XEP0059"), "warn")
                .mockImplementation(() => {});
            const xml = Parser.parse(`
                <set xmlns="http://jabber.org/protocol/rsm">
                  <count>abc</count>
                </set>
            `);
            RSM.parseSetEl(xml);
            expect(warn).toHaveBeenCalledWith("忽略非法的 <count>", '"abc"');
            warn.mockRestore();
        });

        it("未找到 set 时抛错", () => {
            const el = XMPPElement.createElement("fin");
            expect(() => RSM.parseSetEl(el)).toThrow("未找到 set 元素");
        });
    });
});
