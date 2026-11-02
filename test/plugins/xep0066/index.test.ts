import { describe, expect, it } from "vitest";
import XEP0066 from "../../../lib/plugins/xep0066";
import { OOB } from "../../../lib/plugins/xep0066/oob";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0066 插件入口测试：确认特性、转换器、事件与发送。
 *
 * @see https://xmpp.org/extensions/xep-0066.html 1.6 §2
 */
describe("XEP0066 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0066(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("声明 XEP0030 依赖", () => {
    expect(XEP0066.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(OOB.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(OOB.NS)).toBe(
      OOB.parseOobEl,
    );
    expect(connection.matchersOf("message:oob")).toHaveLength(0);
    expect(connection.matchersOf("presence:oob")).toHaveLength(0);
  });

  it("sendOOB 发送携带 OOB 数据的消息", () => {
    const { connection, plugin } = setup();

    plugin.sendOOB("romeo@montague.lit", "https://example.com/a", {
      desc: "File",
    });

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.getAttribute("to")).toBe("romeo@montague.lit");
    expect(sent.getElementsByTagName("x")[0].namespaceURI).toBe(
      OOB.NS,
    );
  });
});
