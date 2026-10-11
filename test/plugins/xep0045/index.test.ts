import { describe, expect, it } from "vitest";
import XEP0045 from "../../../lib/plugins/xep0045";
import { MUC } from "../../../lib/plugins/xep0045/muc";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0045 插件入口测试：确认特性宣告、居住者转换器与全部房间事件注册。
 * 业务逻辑由 muc.test.ts 覆盖，此处只验证入口装配。
 *
 * @see https://xmpp.org/extensions/xep-0045.html 1.34.6 §9.6 Kicking an Occupant、§9.7 Banning an Occupant（状态码 307/301）
 */
describe("XEP0045 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0045(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 MUC、声明 XEP0030 依赖且初始无已加入房间", () => {
    const plugin = new XEP0045(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(MUC);
    expect(XEP0045.dependencies).toEqual(["XEP0030"]);
    expect(plugin.rooms.size).toBe(0);
  });

  it("init 宣告 MUC 特性并注册全部事件", () => {
    const connection = setup();

    expect(connection.features.has(MUC.NS.BASE)).toBe(true);
    expect(connection.stanzaPlugins.get(MUC.NS.USER)).toBe(MUC.parsePresUser);
    expect(connection.eventPlugins.map((e) => e.eventName).sort()).toEqual([
      "muc:ban",
      "muc:decline",
      "muc:destroy",
      "muc:groupchat",
      "muc:join",
      "muc:kick",
      "muc:leave",
      "muc:mediated-invite",
      "muc:subject",
      "muc:voice-request",
    ]);
  });

  it("muc:groupchat 事件只匹配带 body 的群聊消息", () => {
    const connection = setup();
    const [matcher] = connection.matchersOf("muc:groupchat");

    expect(matcher({ type: "groupchat", body: "hi" })).toBe(true);
    expect(matcher({ type: "groupchat" })).toBe(false);
    expect(matcher({ type: "chat", body: "hi" })).toBe(false);
  });

  it("muc:kick/muc:ban 事件要求 unavailable 且携带对应状态码", () => {
    const connection = setup();

    expect(
      connection.matchersOf("muc:kick")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["307"] },
      }),
    ).toBe(true);
    expect(
      connection.matchersOf("muc:kick")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["301"] },
      }),
    ).toBe(false);
    expect(
      connection.matchersOf("muc:ban")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["301"] },
      }),
    ).toBe(true);
  });
});
