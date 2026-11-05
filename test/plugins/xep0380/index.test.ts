import { describe, expect, it } from "vitest";
import XEP0380 from "../../../lib/plugins/xep0380";
import { EME } from "../../../lib/plugins/xep0380/eme";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0380 插件入口测试：特性与转换器注册。
 *
 * @see https://xmpp.org/extensions/xep-0380.html 0.4.0 §3
 */
describe("XEP0380 插件入口", () => {
  it("init 宣告特性并注册转换器", () => {
    const connection = new FakeConnection();
    const plugin = new XEP0380(connection as unknown as Connection);
    plugin.init();

    expect(connection.features.has(EME.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(EME.NS)).toBe(EME.parseEncryptionEl);
  });
});
