import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XEP0199 from "../../../lib/plugins/xep0199";
import Ping from "../../../lib/plugins/xep0199/ping";
import type { Connection } from "../../../lib/connection";
import { XMPPError } from "../../../lib/errors";
import { Iq } from "../../../lib/stanza";
import { Parser } from "../../../lib/ltx/Parser";
import {
  createTcpConnection,
  getServer,
  negotiate,
  serverRef,
  waitForReceived,
  type MockServer,
} from "../../helpers/mock-transport";

// 将 node:net / node:tls 替换为 Mock Socket，避免真实 TCP/TLS 连接
vi.mock("node:net", async () => {
  const { netMock } = await import("../../helpers/mock-transport");
  return netMock();
});
// TLSSocket 需保留真实导出（传输层用 instanceof 判断 TLS 就绪）
vi.mock("node:tls", async (importOriginal) => {
  const { tlsMock } = await import("../../helpers/mock-transport");
  return tlsMock(importOriginal);
});

/** 已建立连接的引用，供 afterEach 统一断开 */
const active = new Set<Connection>();

/** 创建仅注册 XEP0199 的连接；XEP0030 在 connect() 时按依赖自动补齐 */
function createIntegrationConnection(
  options?: ConstructorParameters<typeof XEP0199>[1],
) {
  const connection = createTcpConnection("juliet@capulet.lit/balcony");
  active.add(connection);
  connection.registerPlugin("XEP0199", options);
  return connection;
}

/** 完成「连接 → 认证 → 绑定」并返回插件实例 */
async function connectIntegration(
  options?: ConstructorParameters<typeof XEP0199>[1],
) {
  const connection = createIntegrationConnection(options);
  const sessionStart = new Promise<void>((resolve) =>
    connection.once("session:start", () => resolve()),
  );
  await connection.connect();
  const server = getServer();
  await negotiate(server, "juliet@capulet.lit/balcony");
  await sessionStart;
  return { connection, server, plugin: connection.XEP0199! };
}

/** 应答 XEP0030 在 session:start 后发出的 disco#info 查询 */
async function answerDiscoInfo(server: MockServer, features: string[]) {
  const query = Parser.parse(
    await waitForReceived(server, "http://jabber.org/protocol/disco#info"),
  );
  server.send(`<iq xmlns="jabber:client" type="result" from="capulet.lit" id="${query.getAttribute("id")}">
    <query xmlns="http://jabber.org/protocol/disco#info">
      ${features.map((feature) => `<feature var="${feature}"/>`).join("")}
    </query>
  </iq>`);
}

/**
 * XEP-0199 集成测试：只注册 XEP0199，由连接层按 static dependencies 自动补齐 XEP0030，
 * 经 Mock Socket 完成真实流协商后再验证解析、事件与发往服务端的 stanza。
 *
 * @see https://xmpp.org/extensions/xep-0199.html 2.0.1 §4.1（服务端 ping 客户端）、§4.2（客户端 ping 服务端）
 */
describe("XEP0199 插件入口集成（Mock Socket，仅注册当前插件）", () => {
  beforeEach(() => {
    serverRef.current = null;
  });

  afterEach(() => {
    for (const connection of active) {
      connection.transport?.disconnect();
    }
    active.clear();
  });

  it("仅注册 XEP0199 时自动补齐 XEP0030 并完成流协商", async () => {
    const { connection } = await connectIntegration();

    expect(connection.XEP0199).toBeDefined();
    expect(connection.XEP0030).toBeDefined();
  });

  it("服务器宣告 ping 特性后按 interval 发送 keepalive ping", async () => {
    const { server } = await connectIntegration({ interval: 100, timeout: 90 });
    await answerDiscoInfo(server, [Ping.NS]);

    // keepalive 首个 ping 在 interval 后发出，目标是自身域
    const pingIq = Parser.parse(await waitForReceived(server, Ping.NS));
    expect(pingIq.getAttribute("type")).toBe("get");
    expect(pingIq.getAttribute("to")).toBe("capulet.lit");

    // 应答 ping，避免 sendAsync 在测试结束后才超时
    server.send(`<iq xmlns="jabber:client" type="result" from="capulet.lit" id="${pingIq.getAttribute("id")}"/>`);
  });

  it("服务器未宣告 ping 特性时不启动 keepalive", async () => {
    const { server } = await connectIntegration({ interval: 100, timeout: 90 });
    await answerDiscoInfo(server, []);

    // 等待超过一个 interval，确认没有发出任何 ping
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.received.some((xml) => xml.includes(Ping.NS))).toBe(false);
  });

  it("keepalive ping 超时不中断后续周期", async () => {
    const { server } = await connectIntegration({ interval: 100, timeout: 50 });
    await answerDiscoInfo(server, [Ping.NS]);

    const pingCount = () =>
      server.received.filter((xml) => xml.includes(Ping.NS)).length;

    // 首个 ping 不应答，等 sendAsync 超时进入错误处理
    await waitForReceived(server, Ping.NS);
    // 只有发出第二个 ping 才能证明定时器未被超时中断
    await vi.waitFor(() => expect(pingCount()).toBeGreaterThanOrEqual(2));
  });

  it("keepalive=false 时即使服务器支持也不发 ping", async () => {
    const { server } = await connectIntegration({
      keepalive: false,
      interval: 100,
      timeout: 90,
    });
    await answerDiscoInfo(server, [Ping.NS]);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.received.some((xml) => xml.includes(Ping.NS))).toBe(false);
  });

  it("服务器特性查询失败时不启动 keepalive", async () => {
    const { server } = await connectIntegration({ interval: 100, timeout: 90 });
    const query = Parser.parse(
      await waitForReceived(server, "http://jabber.org/protocol/disco#info"),
    );
    server.send(`<iq xmlns="jabber:client" type="error" from="capulet.lit" id="${query.getAttribute("id")}">
      <error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
    </iq>`);

    // 等查询失败链路走完，确认没有因为错误而启动 keepalive
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.received.some((xml) => xml.includes(Ping.NS))).toBe(false);
  });

  it("收到服务器 ping 时派发 iq 事件并回复 result", async () => {
    const { connection, server } = await connectIntegration();
    await answerDiscoInfo(server, []);

    const receivedIq = new Promise<Iq>((resolve) =>
      connection.once("iq", resolve),
    );
    server.send(`<iq xmlns="jabber:client" from="capulet.lit"
      to="juliet@capulet.lit/balcony" type="get" id="s2c1">
      <ping xmlns="${Ping.NS}"/>
    </iq>`);

    // 解析后先派发 iq 事件，再由插件回复 result
    await expect(receivedIq).resolves.toMatchObject({ type: "get", id: "s2c1" });
    const reply = Parser.parse(await waitForReceived(server, 'id="s2c1"'));
    expect(reply.getAttribute("type")).toBe("result");
    expect(reply.getAttribute("to")).toBe("capulet.lit");
  });

  it("ping() 发出请求并在收到 result 后返回耗时", async () => {
    const { server, plugin } = await connectIntegration();
    await answerDiscoInfo(server, []);

    const pending = plugin.ping("capulet.lit", 1000);
    const pingIq = Parser.parse(await waitForReceived(server, Ping.NS));
    expect(pingIq.getAttribute("type")).toBe("get");
    expect(pingIq.getAttribute("to")).toBe("capulet.lit");

    server.send(`<iq xmlns="jabber:client" type="result" from="capulet.lit" id="${pingIq.getAttribute("id")}"/>`);
    await expect(pending).resolves.toBeGreaterThanOrEqual(0);
  });

  it("ping() 收到 error 时抛出 XMPPError", async () => {
    const { server, plugin } = await connectIntegration();
    await answerDiscoInfo(server, []);

    const pending = plugin.ping("capulet.lit", 1000);
    const pingIq = Parser.parse(await waitForReceived(server, Ping.NS));
    server.send(`<iq xmlns="jabber:client" type="error" from="capulet.lit" id="${pingIq.getAttribute("id")}">
      <error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
    </iq>`);

    await expect(pending).rejects.toBeInstanceOf(XMPPError);
  });
});
