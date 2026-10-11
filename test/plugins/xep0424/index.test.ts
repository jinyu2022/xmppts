import { describe, expect, it } from "vitest";
import XEP0424 from "../../../lib/plugins/xep0424";
import { Retraction } from "../../../lib/plugins/xep0424/retraction";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0424 插件入口测试：确认撤回转换器与 message:retract 事件注册、retract 发送。
 *
 * @see https://xmpp.org/extensions/xep-0424.html 0.5.0 §3 Use Case（Example 5）
 */
describe("XEP0424 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0424(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Retraction 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0424(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Retraction);
    expect(XEP0424.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性、注册转换器与 message:retract 事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Retraction.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Retraction.NS)).toBe(Retraction.parseRetractionEl);
    expect(connection.matchersOf("message:retract")).toHaveLength(1);
    expect(
      connection.matchersOf("message:retract")[0]({ retract: { id: "wrong-recipient-1" } }),
    ).toBe(true);
    expect(connection.matchersOf("message:retract")[0]({})).toBe(false);
  });

  it("retract 发送指向原消息的撤回请求", () => {
    const { connection, plugin } = setup();

    // 规范 Example 5：撤回 Example 4 中 id='wrong-recipient-1' 的消息
    plugin.retract(
      "lord@capulet.example",
      "wrong-recipient-1",
      "chat",
      "/me retracted a previous message, but it's unsupported by your client.",
    );

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.tagName).toBe("message");
    expect(sent.getElementsByTagNameNS(Retraction.NS, "retract")[0].getAttribute("id")).toBe(
      "wrong-recipient-1",
    );
  });
});
