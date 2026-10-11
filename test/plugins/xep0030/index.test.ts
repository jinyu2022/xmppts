import { describe, expect, it, vi } from "vitest";
import { XEP0030 } from "../../../lib/plugins/xep0030";
import type { Connection } from "../../../lib/connection";
import { XMPPError } from "../../../lib/errors";
import { Parser } from "../../../lib/ltx/Parser";
import { Status } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0030 插件入口测试：会话门控、查询复用与快照副本。
 * 用例取自 §3/§4 的规范示例。
 *
 * @see https://xmpp.org/extensions/xep-0030.html 2.5.0 §3 Service Discovery Information
 */
describe("XEP0030 插件入口", () => {
  /** Example 2：服务器 disco#info 应答的简化版 */
  const SERVER_INFO = `
    <iq type="result" from="shakespeare.lit" to="romeo@montague.net/orchard" id="info1">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="server" type="im" name="Shakespeare IM"/>
        <feature var="urn:xmpp:ping"/>
      </query>
    </iq>
  `;

  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0030(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("初始化不发请求；session:start 自动发现一次", () => {
    const { connection } = setup();
    const sendAsync = vi.spyOn(connection, "sendAsync");
    expect(sendAsync).not.toHaveBeenCalled();

    connection.transport = { status: Status.BINDED };
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    connection.emit("session:start");
    expect(sendAsync).toHaveBeenCalledTimes(1);
  });

  it("会话未就绪：getter 直接拒绝且不发送查询", async () => {
    const { connection, plugin } = setup();
    const sendAsync = vi.spyOn(connection, "sendAsync");

    await expect(plugin.getServerFeatures()).rejects.toThrow("会话尚未就绪");
    await expect(plugin.getServerIdentities()).rejects.toThrow("会话尚未就绪");
    expect(sendAsync).not.toHaveBeenCalled();
  });

  it("会话就绪：并发 getter 复用同一次查询并返回副本", async () => {
    const { connection, plugin } = setup();
    connection.transport = { status: Status.BINDED };
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    const sendAsync = vi.spyOn(connection, "sendAsync");

    const [features, identities] = await Promise.all([
      plugin.getServerFeatures(),
      plugin.getServerIdentities(),
    ]);
    expect(sendAsync).toHaveBeenCalledTimes(1);
    expect(features.has("urn:xmpp:ping")).toBe(true);
    expect(identities).toEqual([
      { category: "server", type: "im", name: "Shakespeare IM", lang: undefined },
    ]);

    // 返回值是快照副本，外部修改不影响后续查询
    features.add("urn:xmpp:fake");
    const again = await plugin.getServerFeatures();
    expect(again.has("urn:xmpp:fake")).toBe(false);
    expect(sendAsync).toHaveBeenCalledTimes(1);
  });

  it("会话结束：已查询过也不返回旧快照", async () => {
    const { connection, plugin } = setup();
    connection.transport = { status: Status.BINDED };
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    await plugin.getServerFeatures();

    connection.transport = { status: Status.DISCONNECTED };
    await expect(plugin.getServerFeatures()).rejects.toThrow("会话尚未就绪");
  });

  it("服务器返回 IQ error：reject 且下次调用重新查询", async () => {
    const { connection, plugin } = setup();
    connection.transport = { status: Status.BINDED };
    connection.sendAsyncResult = Parser.parse(
      `<iq type="error" id="info1"><error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`
    );
    const sendAsync = vi.spyOn(connection, "sendAsync");

    await expect(plugin.getServerFeatures()).rejects.toBeInstanceOf(XMPPError);

    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    await expect(plugin.getServerFeatures()).resolves.toBeInstanceOf(Set);
    expect(sendAsync).toHaveBeenCalledTimes(2);
  });
});
