import { describe, expect, it } from "vitest";
import XEP0421 from "../../../lib/plugins/xep0421";
import { OccupantId } from "../../../lib/plugins/xep0421/occupantId";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0421 插件入口测试：确认转换器与房间特性检查。
 *
 * @see https://xmpp.org/extensions/xep-0421.html 1.0.1 §2/§4/§5
 */
describe("XEP0421 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0421(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 OccupantId 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0421(
      new FakeConnection() as unknown as Connection,
    );
    expect(plugin).toBeInstanceOf(OccupantId);
    expect(XEP0421.dependencies).toEqual(["XEP0030"]);
  });

  it("init 不宣告房间特性，只注册转换器", () => {
    const { connection } = setup();

    // occupant-id 是房间能力，客户端宣告会让对端误以为本端提供该能力
    expect(connection.features.has(OccupantId.NS)).toBe(false);
    expect(connection.stanzaPlugins.get(OccupantId.NS)).toBe(
      OccupantId.parseOccupantIdEl,
    );
    expect(connection.matchersOf("message:occupant-id")).toHaveLength(0);
    expect(connection.matchersOf("presence:occupant-id")).toHaveLength(0);
  });

  it("hasOccupantIdFeature 仅在房间宣告 occupant-id 时返回 true", async () => {
    const { connection, plugin } = setup();
    const room = "coven@chat.shakespeare.lit";

    connection.discoInfo.set(room, {
      identities: [],
      features: new Set([OccupantId.NS]),
    });
    await expect(plugin.hasOccupantIdFeature(room)).resolves.toBe(true);

    connection.discoInfo.set(room, {
      identities: [],
      features: new Set(),
    });
    await expect(plugin.hasOccupantIdFeature(room)).resolves.toBe(false);
  });
});
