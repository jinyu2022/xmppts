import { describe, expect, it } from "vitest";
import XEP0428 from "../../../lib/plugins/xep0428";
import { Fallback } from "../../../lib/plugins/xep0428/fallback";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0428 插件入口测试：特性与转换器注册。
 *
 * @see https://xmpp.org/extensions/xep-0428.html 0.2.1 §2
 */
describe("XEP0428 插件入口", () => {
  it("init 宣告特性并注册转换器", () => {
    const connection = new FakeConnection();
    const plugin = new XEP0428(connection as unknown as Connection);
    plugin.init();

    expect(connection.features.has(Fallback.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Fallback.NS)).toBe(
      Fallback.parseFallbackEl,
    );
  });
});
