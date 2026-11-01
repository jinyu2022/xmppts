import { describe, expect, it } from "vitest";
import XEP0045 from "../../../lib/plugins/xep0045";
import { MUC } from "../../../lib/plugins/xep0045/muc";
import { XEP0030 } from "../../../lib/plugins/xep0030";
import { Connection, type SocketEventMap } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0045 插件入口测试：确认特性宣告、居住者转换器与全部房间事件注册。
 * 业务逻辑由 muc.test.ts 覆盖，此处只验证入口装配。
 *
 * @see https://xmpp.org/extensions/xep-0045.html 1.34.6 §7.4 Sending a Message to All Occupants、
 *      §9.6 Kicking an Occupant、§9.7 Banning an Occupant（状态码 307/301）
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

  it("真实连接：§7.4 的房内消息经转换层派发 muc:groupchat", () => {
    const connection = new Connection("crone1@shakespeare.lit/desktop", "test123");
    // 插件 init 依赖 XEP0030.addFeature，这里挂上真实实例而不触发会话事件
    const disco = new XEP0030(connection);
    disco.init();
    Object.assign(connection, { XEP0030: disco });
    new XEP0045(connection).init();

    const groupchat: Array<SocketEventMap["muc:groupchat"]> = [];
    connection.on("muc:groupchat", (message) => groupchat.push(message));

    // §7.4 Example「Service Reflects Message to All Occupants」
    // 绕过 socket 与 XML 流解析，直接把已解析的 stanza 交给连接层接收处理
    connection._createSink().onStanza(
      Parser.parse(`
        <message xmlns="jabber:client" from="coven@chat.shakespeare.lit/thirdwitch" id="hysf1v37" to="crone1@shakespeare.lit/desktop" type="groupchat">
          <body>Harpier cries: 'tis time, 'tis time.</body>
        </message>
      `),
    );

    expect(groupchat).toHaveLength(1);
    expect(groupchat[0].body).toBe("Harpier cries: 'tis time, 'tis time.");
  });

  it("真实连接：§9.6 的踢出通知经转换层派发 muc:kick", () => {
    const connection = new Connection("pistol@shakespeare.lit/harfleur", "test123");
    const disco = new XEP0030(connection);
    disco.init();
    Object.assign(connection, { XEP0030: disco });
    new XEP0045(connection).init();

    const kicks: Array<SocketEventMap["muc:kick"]> = [];
    connection.on("muc:kick", (presence) => kicks.push(presence));

    // §9.6 Example「Service Removes Kicked Occupant」：actor/reason 在 item 内部
    connection._createSink().onStanza(
      Parser.parse(`
        <presence xmlns="jabber:client" from="harfleur@chat.shakespeare.lit/pistol" to="pistol@shakespeare.lit/harfleur" type="unavailable">
          <x xmlns="http://jabber.org/protocol/muc#user">
            <item affiliation="none" role="none">
              <actor nick="Fluellen"/>
              <reason>Avaunt, you cullion!</reason>
            </item>
            <status code="110"/>
            <status code="307"/>
          </x>
        </presence>
      `),
    );

    expect(kicks).toHaveLength(1);
    expect(kicks[0].muc.statuses).toEqual(["110", "307"]);
    expect(kicks[0].muc.item?.actor?.nick).toBe("Fluellen");
    expect(kicks[0].muc.item?.reason).toBe("Avaunt, you cullion!");
  });
});
