import { describe, expect, it } from "vitest";
import XEP0163 from "../../../lib/plugins/xep0163";
import { PEP } from "../../../lib/plugins/xep0163/pep";
import { Pubsub } from "../../../lib/plugins/xep0060/pubsub";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0163 插件入口测试：确认 PEP 事件转换器已注册。
 *
 * @see https://xmpp.org/extensions/xep-0163.html 1.2.2 §3 Publishing Events（Example 6）
 */
describe("XEP0163 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0163(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 PEP 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0163(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(PEP);
    expect(XEP0163.dependencies).toEqual(["XEP0030"]);
  });

  it("init 注册 pubsub#event 命名空间的转换器", () => {
    const connection = setup();
    expect(connection.stanzaPlugins.get(Pubsub.NS.EVENT)).toBe(Pubsub.parseEventEl);
  });
});
