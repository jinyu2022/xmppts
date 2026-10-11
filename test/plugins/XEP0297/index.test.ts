import { describe, expect, it } from "vitest";
import XEP0297 from "../../../lib/plugins/XEP0297";
import { Forward } from "../../../lib/plugins/XEP0297/forward";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0297 插件入口测试：确认转发元素转换器与 forward 事件注册。
 *
 * @see https://xmpp.org/extensions/xep-0297.html 1.0 §3.1 Overview（Example 2）
 */
describe("XEP0297 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0297(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 Forward 并声明 XEP0030/XEP0203 依赖", () => {
    const plugin = new XEP0297(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Forward);
    expect(XEP0297.dependencies).toEqual(["XEP0030", "XEP0203"]);
  });

  it("init 注册转换器与 forward 事件", () => {
    const connection = setup();

    expect(connection.stanzaPlugins.get(XEP0297.NS)).toBe(XEP0297.parseForwardedEl);
    expect(connection.matchersOf("forward")).toHaveLength(1);
    expect(connection.matchersOf("forward")[0]({ forwarded: {} })).toBe(true);
    expect(connection.matchersOf("forward")[0]({})).toBe(false);
  });
});
