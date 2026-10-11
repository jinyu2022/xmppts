import { describe, expect, it } from "vitest";
import XEP0359 from "../../../lib/plugins/xep0359";
import { StanzaID } from "../../../lib/plugins/xep0359/stanzaID";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0359 插件入口测试：确认稳定 ID 特性宣告与转换器注册。
 *
 * @see https://xmpp.org/extensions/xep-0359.html 0.7.0 §2.1 Unique stanza IDs（Example 1）
 */
describe("XEP0359 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0359(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 StanzaID 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0359(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(StanzaID);
    expect(XEP0359.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性并注册稳定 ID 转换器", () => {
    const connection = setup();

    expect(connection.features.has(StanzaID.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(StanzaID.NS)).toBe(StanzaID.parseStanzaId);
  });

  it("注册的转换器解析 <stanza-id/>", () => {
    const connection = setup();
    const handler = connection.stanzaPlugins.get(StanzaID.NS)!;
    // 规范 Example 1 的 <stanza-id/> 属性
    const transformed = handler(
      Parser.parse(
        `<stanza-id xmlns="${StanzaID.NS}" id="de305d54-75b4-431b-adb2-eb6b9e546013" by="room@muc.example.com"/>`,
      ),
    );
    expect(transformed).toHaveProperty("stanzaID");
  });
});
