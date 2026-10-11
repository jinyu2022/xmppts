import { describe, expect, it } from "vitest";
import XEP0308 from "../../../lib/plugins/xep0308";
import { Correction } from "../../../lib/plugins/xep0308/correction";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0308 插件入口测试：确认特性宣告、转换器与 message:correct 事件注册，
 * 以及 correctMessage 发送带 <replace/> 的消息。
 *
 * @see https://xmpp.org/extensions/xep-0308.html 1.2.1 §3 Use Case（Example 4）
 */
describe("XEP0308 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0308(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Correction 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0308(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Correction);
    expect(XEP0308.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性、注册转换器与 message:correct 事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Correction.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Correction.NS)).toBe(Correction.parseReplaceEl);
    expect(connection.matchersOf("message:correct")).toHaveLength(1);
    expect(connection.matchersOf("message:correct")[0]({ replace: { id: "old" } })).toBe(
      true,
    );
    expect(connection.matchersOf("message:correct")[0]({})).toBe(false);
  });

  it("correctMessage 发送指向原消息的更正", () => {
    const { connection, plugin } = setup();

    // 规范 Example 4：更正 Example 3 中 id='bad1' 的消息
    plugin.correctMessage(
      "juliet@capulet.net/balcony",
      "bad1",
      "But soft, what light through yonder window breaks?",
    );

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.tagName).toBe("message");
    expect(sent.getElementsByTagNameNS(Correction.NS, "replace")[0].getAttribute("id")).toBe(
      "bad1",
    );
    expect(sent.getElementsByTagName("body")[0].textContent).toBe(
      "But soft, what light through yonder window breaks?",
    );
  });
});
