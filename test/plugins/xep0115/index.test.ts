import { describe, expect, it, vi } from "vitest";
import XEP0115 from "../../../lib/plugins/xep0115";
import { EntityCaps } from "../../../lib/plugins/xep0115/entityCaps";
import type { Connection } from "../../../lib/connection";
import { Presence } from "../../../lib/stanza";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0115 插件入口测试：确认特性宣告、caps 转换器与发送拦截注册，
 * 以及 connect 后生成自身能力并附加到 presence。
 *
 * @see https://xmpp.org/extensions/xep-0115.html 1.5.4 §3 Entity Capabilities（Examples 中的 JID）
 */
describe("XEP0115 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0115(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 EntityCaps 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0115(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(EntityCaps);
    expect(XEP0115.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性并注册 caps 转换器", () => {
    const { connection } = setup();

    expect(connection.features.has(EntityCaps.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(EntityCaps.NS)).toBe(EntityCaps.parseCaps);
  });

  it("会话就绪后生成的自身能力被附加到发出的 presence", async () => {
    const { connection, plugin } = setup();
    const to = "benvolio@capulet.lit/230193";

    // selfCaps 生成走异步（crypto.subtle），未生成前不附加
    const before = Presence.createPresence(to);
    connection.pipeline.run("send", { stanza: before });
    expect(before.getElementsByTagNameNS(EntityCaps.NS, "c")).toHaveLength(0);

    plugin.onSessionBound();
    await vi.waitFor(() => {
      const presence = Presence.createPresence(to);
      connection.pipeline.run("send", { stanza: presence });
      const [c] = presence.getElementsByTagNameNS(EntityCaps.NS, "c");
      expect(c).toBeDefined();
      // 未配置 node 时使用插件默认值
      expect(c.getAttribute("node")).toBe("http://xmppts.chat");
    });
  });

  it("使用配置的 node 生成自身能力", async () => {
    const connection = new FakeConnection();
    const node = "urn:xmppts:caps";
    const plugin = new XEP0115(connection as unknown as Connection, { node });
    plugin.init();
    plugin.onSessionBound();

    await vi.waitFor(() => {
      const presence = Presence.createPresence("benvolio@capulet.lit/230193");
      connection.pipeline.run("send", { stanza: presence });
      const [c] = presence.getElementsByTagNameNS(EntityCaps.NS, "c");
      expect(c).toBeDefined();
      expect(c.getAttribute("node")).toBe(node);
    });
  });
});
