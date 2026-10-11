import { describe, expect, it } from "vitest";
import XEP0203 from "../../../lib/plugins/xep0203";
import { Delay } from "../../../lib/plugins/xep0203/delay";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0203 插件入口测试：确认延迟送达元素的转换器已注册且可用。
 *
 * @see https://xmpp.org/extensions/xep-0203.html 2.0 §3 Examples（Example 1）
 */
describe("XEP0203 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0203(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 Delay 并在 init 注册延迟元素转换器", () => {
    const plugin = new XEP0203(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Delay);

    const connection = setup();
    expect(connection.stanzaPlugins.get(XEP0203.NS)).toBe(XEP0203.parseDelayEl);
  });

  it("注册的转换器把 <delay/> 解析为 stamp", () => {
    const connection = setup();
    const handler = connection.stanzaPlugins.get(XEP0203.NS)!;
    // 规范 Example 1 的 <delay/> 属性
    const transformed = handler(
      Parser.parse(
        `<delay xmlns="${XEP0203.NS}" from="capulet.com" stamp="2002-09-10T23:08:25Z"/>`,
      ),
    );
    expect(transformed).toHaveProperty("delay");
  });
});
