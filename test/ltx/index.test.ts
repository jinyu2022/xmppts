import { describe, expect, it } from "vitest";
import * as ltx from "../../lib/ltx";
import { Parser } from "../../lib/ltx/Parser";
import { XMPPElement } from "../../lib/ltx/Element";

/**
 * ltx barrel 测试：导出面与底层实现一致。
 *
 * @see https://xmpp.org/extensions/xep-0297.html 1.0 §3.1 Overview（Example 1 的 message 结构）
 */
describe("ltx barrel", () => {
  it("Element 与转义工具完整导出", () => {
    expect(ltx.Parser).toBe(Parser);
    expect(ltx.XMPPElement).toBe(XMPPElement);
    expect(typeof ltx.escapeXML).toBe("function");
    expect(typeof ltx.unescapeXML).toBe("function");
    expect(typeof ltx.escapeXMLText).toBe("function");
    expect(typeof ltx.unescapeXMLText).toBe("function");
  });

  it("Parser.parse 返回可查询的元素树", () => {
    const element = Parser.parse(
      `<message xmlns="jabber:client"><body>Yet I should kill thee with much cherishing.</body></message>`,
    );
    expect(element).toBeInstanceOf(XMPPElement);
    expect(element.getElementsByTagName("body")[0].textContent).toBe(
      "Yet I should kill thee with much cherishing.",
    );
  });
});
