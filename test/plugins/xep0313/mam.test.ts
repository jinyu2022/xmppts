import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { Mam } from "../../../lib/plugins/xep0313/mam";
import { XMPPElement } from "../../../lib/ltx/Element";

/**
 * XEP-0313: Message Archive Management
 * @see https://xmpp.org/extensions/xep-0313.html
 * @version 1.1.3 (2025-04-09)
 *
 * 查询构造与结果解析的用例取自 §4（查询、表单、结果、fin）与 §5（元数据）。
 */

/** 取表单中指定 var 的字段 */
function field(form: XMPPElement, name: string): XMPPElement {
    const found = Array.from(form.getElementsByTagName("field")).find(
        (item) => item.getAttribute("var") === name,
    );
    if (!found) throw new Error(`表单中缺少字段 ${name}`);
    return found;
}

/** 取字段的首个 value 文本 */
function value(form: XMPPElement, name: string): string {
    return field(form, name).querySelector(":scope > value")!.textContent;
}

describe("Mam", () => {
    describe("createQueryIq", () => {
        it("§4：无过滤条件时只带 FORM_TYPE 与 queryid", () => {
            const iq = Mam.createQueryIq("juliet@capulet.lit", {}, "f27");
            expect(iq.tagName).toBe("iq");
            expect(iq.getAttribute("type")).toBe("set");
            expect(iq.getAttribute("to")).toBe("juliet@capulet.lit");
            const query = iq.querySelector(":scope > query")!;
            expect(query.namespaceURI).toBe(Mam.NS);
            expect(query.getAttribute("queryid")).toBe("f27");
            const form = query.querySelector(":scope > x")!;
            expect(form.getAttribute("type")).toBe("submit");
            expect(value(form, "FORM_TYPE")).toBe(Mam.NS);
            expect(form.getElementsByTagName("field")).toHaveLength(1);
        });

        it("§4.1.1：with 使用 jid-single 字段", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                { with: "juliet@capulet.lit" },
                "q1",
            );
            const form = iq.querySelector(":scope > query > x")!;
            expect(field(form, "with").getAttribute("type")).toBe("jid-single");
            expect(value(form, "with")).toBe("juliet@capulet.lit");
        });

        it("§4.1.2：start/end 按 XEP-0082 的 dateTime 写出", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                {
                    start: new Date(Date.UTC(2010, 5, 7)),
                    end: new Date(Date.UTC(2010, 6, 7, 13, 23, 54)),
                },
                "q2",
            );
            const form = iq.querySelector(":scope > query > x")!;
            expect(value(form, "start")).toBe("2010-06-07T00:00:00Z");
            expect(value(form, "end")).toBe("2010-07-07T13:23:54Z");
        });

        it("§4.1.3：before-id / after-id / ids 写入对应字段", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                {
                    afterId: "28482-98726-73623",
                    beforeId: "09af3-cc343-b409f",
                    ids: ["uid-1", "uid-2"],
                },
                "q3",
            );
            const form = iq.querySelector(":scope > query > x")!;
            expect(value(form, "after-id")).toBe("28482-98726-73623");
            expect(value(form, "before-id")).toBe("09af3-cc343-b409f");
            const ids = Array.from(
                field(form, "ids").querySelectorAll(":scope > value"),
            ).map((el) => el.textContent);
            expect(ids).toEqual(["uid-1", "uid-2"]);
        });

        it("§4.1.4：include-groupchat 为布尔字段，false 也要写出", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                { includeGroupchat: false },
                "q4",
            );
            const form = iq.querySelector(":scope > query > x")!;
            expect(field(form, "include-groupchat").getAttribute("type")).toBe(
                "boolean",
            );
            expect(value(form, "include-groupchat")).toBe("false");
        });

        it("§4.2：page 生成 RSM 的 <set/>", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                { page: { max: 10, after: "09af3-cc343-b409f" } },
                "q5",
            );
            const set = iq.querySelector(":scope > query > set")!;
            expect(set.namespaceURI).toBe("http://jabber.org/protocol/rsm");
            expect(set.getElementsByTagName("max")[0].textContent).toBe("10");
            expect(set.getElementsByTagName("after")[0].textContent).toBe(
                "09af3-cc343-b409f",
            );
        });

        it("archive 写入 iq 的 to", () => {
            const iq = Mam.createQueryIq(
                "coven@chat.shakespeare.lit",
                {},
                "q6",
            );
            expect(iq.getAttribute("to")).toBe("coven@chat.shakespeare.lit");
        });

        it("§4.2.3：flip 生成 <flip-page/>", () => {
            const iq = Mam.createQueryIq(
                "juliet@capulet.lit",
                { flip: true },
                "q7",
            );
            const flip = iq.querySelector(":scope > query > flip-page");
            expect(flip).not.toBeNull();
            expect(flip!.namespaceURI).toBe(Mam.NS);
        });

        it("flip 缺省时不写 <flip-page/>", () => {
            const iq = Mam.createQueryIq("juliet@capulet.lit", {}, "q8");
            expect(iq.querySelector(":scope > query > flip-page")).toBeNull();
        });
    });

    describe("parseResultEl", () => {
        it("§4：解析 id/queryid 与 forwarded 中的 delay", () => {
            const message = Parser.parse(`
                <message xmlns="jabber:client" to="juliet@capulet.lit/chamber">
                  <result xmlns="urn:xmpp:mam:2" queryid="f27" id="28482-98726-73623">
                    <forwarded xmlns="urn:xmpp:forward:0">
                      <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                      <message xmlns="jabber:client"
                               from="romeo@montague.lit/orchard"
                               type="chat">
                        <body>Call me but love</body>
                      </message>
                    </forwarded>
                  </result>
                </message>
            `);
            const { result } = Mam.parseResultEl(message);
            expect(result.id).toBe("28482-98726-73623");
            expect(result.queryid).toBe("f27");
            expect(result.stamp?.getTime()).toBe(
                Date.UTC(2010, 6, 10, 23, 8, 25),
            );
            expect(result.message?.tagName).toBe("message");
            expect(result.message?.textContent).toContain("Call me but love");
        });

        it("可传入 result 元素本身", () => {
            const result = Parser.parse(`
                <result xmlns="urn:xmpp:mam:2" queryid="g27" id="78527-06716-51603">
                  <forwarded xmlns="urn:xmpp:forward:0">
                    <message xmlns="jabber:client" from="coven@chat.shakespeare.lit/firstwitch" type="groupchat">
                      <body>Thrice the brinded cat hath mew'd.</body>
                    </message>
                  </forwarded>
                </result>
            `);
            const parsed = Mam.parseResultEl(result).result;
            expect(parsed.id).toBe("78527-06716-51603");
            // delay 是 SHOULD，缺失时不给 stamp
            expect(parsed.stamp).toBeUndefined();
        });

        it("未找到 result 时抛错", () => {
            const el = XMPPElement.createElement("message");
            expect(() => Mam.parseResultEl(el)).toThrow("未找到 result 元素");
        });
    });

    describe("parseFinEl", () => {
        it("§4.2.2：解析 complete/stable 与 RSM 分页信息", () => {
            const iq = Parser.parse(`
                <iq xmlns="jabber:client" type="result" id="u29303">
                  <fin xmlns="urn:xmpp:mam:2" complete="true">
                    <set xmlns="http://jabber.org/protocol/rsm">
                      <first index="0">23452-4534-1</first>
                      <last>390-2342-22</last>
                      <count>16</count>
                    </set>
                  </fin>
                </iq>
            `);
            const { fin } = Mam.parseFinEl(iq);
            expect(fin.complete).toBe(true);
            expect(fin.stable).toBe(true);
            expect(fin.rsm).toEqual({
                first: { value: "23452-4534-1", index: 0 },
                last: "390-2342-22",
                count: 16,
            });
        });

        it("§4.2.2：complete 缺省为 false，stable 缺省为 true", () => {
            const el = Parser.parse(`<fin xmlns="urn:xmpp:mam:2"/>`);
            const { fin } = Mam.parseFinEl(el);
            expect(fin.complete).toBe(false);
            expect(fin.stable).toBe(true);
            expect(fin.rsm).toBeUndefined();
        });

        it("§4.2.2：stable 为 false 时如实报告", () => {
            const el = Parser.parse(
                `<fin xmlns="urn:xmpp:mam:2" stable="false"/>`,
            );
            expect(Mam.parseFinEl(el).fin.stable).toBe(false);
        });

        it("未找到 fin 时抛错", () => {
            const el = XMPPElement.createElement("iq");
            expect(() => Mam.parseFinEl(el)).toThrow("未找到 fin 元素");
        });
    });

    describe("parseMetadataEl", () => {
        it("§5：解析归档首尾消息的 id 与时间", () => {
            const iq = Parser.parse(`
                <iq xmlns="jabber:client" type="result" id="jui8921rr9">
                  <metadata xmlns="urn:xmpp:mam:2">
                    <start id="YWxwaGEg" timestamp="2008-08-22T21:09:04Z" />
                    <end id="b21lZ2Eg" timestamp="2020-04-20T14:34:21Z" />
                  </metadata>
                </iq>
            `);
            const { metadata } = Mam.parseMetadataEl(iq);
            expect(metadata.start?.id).toBe("YWxwaGEg");
            expect(metadata.start?.timestamp.getTime()).toBe(
                Date.UTC(2008, 7, 22, 21, 9, 4),
            );
            expect(metadata.end?.id).toBe("b21lZ2Eg");
            expect(metadata.end?.timestamp.getTime()).toBe(
                Date.UTC(2020, 3, 20, 14, 34, 21),
            );
        });

        it("§5：空归档的 metadata 为空元素", () => {
            const el = Parser.parse(`<metadata xmlns="urn:xmpp:mam:2"/>`);
            expect(Mam.parseMetadataEl(el).metadata).toEqual({
                start: undefined,
                end: undefined,
            });
        });
    });
});
