import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection, type SocketEventMap } from "../lib/connection";
import { Parser } from "../lib/ltx/Parser";
import { Status } from "../lib/transport/typing";
import {
  getServer,
  serverRef,
  stats,
  waitForReceived,
  type MockServer,
} from "./helpers/mock-transport";

// 将 node:net / node:tls 替换为 Mock Socket，避免真实 TCP/TLS 连接
vi.mock("node:net", async () => {
  const { netMock } = await import("./helpers/mock-transport");
  return netMock();
});
// TLSSocket 需保留真实导出（instanceof 判断依赖它）
vi.mock("node:tls", async (importOriginal) => {
  const { tlsMock } = await import("./helpers/mock-transport");
  return tlsMock(importOriginal);
});

/** 只宣告 PLAIN 认证机制的流特性 */
const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

/** 认证后宣告资源绑定的流特性 */
const BIND_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>`;

const SASL_SUCCESS = `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`;

/**
 * Connection 层集成测试：使用 Mock Socket 模拟服务端，
 * 验证会话生命周期事件与自动重连的事件时序。
 */

/** 创建非 TLS 直连 localhost 的连接 */
function createConnection(
  options: { reconnect?: boolean; reconnectMaxAttempts?: number } = {},
): Connection {
  return new Connection("juliet@capulet.lit/balcony", "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
    ...options,
  });
}

/** 等待底层 socket 创建并返回对应 Mock 服务端（socket 在 connect() 内的微任务中创建） */
async function awaitServer(): Promise<MockServer> {
  return await vi.waitFor(() => getServer(), { timeout: 5000 });
}

/** 等待一次高层事件，忽略事件参数 */
function waitForEvent<T extends keyof SocketEventMap>(
  connection: Connection,
  event: T,
): Promise<void> {
  return new Promise((resolve) => {
    connection.once(event, () => resolve());
  });
}

/** 推进一次完整协商：TCP 建立 → 流头 → PLAIN 认证 → 流重启 → 资源绑定 */
async function negotiate(server: MockServer, boundJid: string): Promise<void> {
  server.acceptConnection();
  await waitForReceived(server, "<stream:stream");
  server.send(AUTH_FEATURES);
  await waitForReceived(server, "<auth");
  server.send(SASL_SUCCESS);
  await waitForReceived(server, "<stream:stream");
  server.send(BIND_FEATURES);
  const bind = Parser.parse(await waitForReceived(server, "<iq"));
  server.send(`<iq xmlns="jabber:client" id="${bind.getAttribute("id")}" type="result">
    <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
      <jid>${boundJid}</jid>
    </bind>
  </iq>`);
}

/** 连接并完成协商，等待 session:start */
async function connectAndNegotiate(
  connection: Connection,
  boundJid = "juliet@capulet.lit/server-resource",
): Promise<MockServer> {
  const started = waitForEvent(connection, "session:start");
  await connection.connect();
  const server = await awaitServer();
  await negotiate(server, boundJid);
  await started;
  return server;
}

describe("Connection 会话生命周期", () => {
  /** 当前用例的连接，供 afterEach 清理 */
  let connection: Connection | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    serverRef.current = null;
    stats.connections = 0;
    connection = undefined;
  });

  afterEach(() => {
    try {
      connection?.disconnect();
    } catch {
      // 已断开时无需处理
    }
  });

  it("完成协商后触发 session:start 并采用服务端分配的 JID", async () => {
    const active = createConnection();
    connection = active;

    await connectAndNegotiate(active, "juliet@capulet.lit/server-resource");

    expect(active.jid.toString()).toBe("juliet@capulet.lit/server-resource");
    expect(active.transport?.status).toBe(Status.BINDED);
  });

  it("未启用自动重连：服务端断开后依次触发 session:end 与 disconnect", async () => {
    const active = createConnection();
    connection = active;
    const server = await connectAndNegotiate(active);

    const events: string[] = [];
    active.on("session:end", () => events.push("session:end"));
    active.on("disconnect", () => events.push("disconnect"));
    const disconnected = waitForEvent(active, "disconnect");

    server.close();
    await disconnected;

    expect(events).toEqual(["session:end", "disconnect"]);
    expect(active.transport?.status).toBe(Status.DISCONNECTED);
  });

  it("启用自动重连：断线触发 connection:lost，重连成功后触发 reconnected 且不再触发 session:start", async () => {
    const active = createConnection({ reconnect: true });
    connection = active;

    let sessionStarts = 0;
    active.on("session:start", () => (sessionStarts += 1));
    const server = await connectAndNegotiate(active);
    expect(sessionStarts).toBe(1);

    const events: string[] = [];
    active.on("connection:lost", () => events.push("connection:lost"));
    active.on("reconnecting", () => events.push("reconnecting"));
    active.on("reconnected", () => events.push("reconnected"));
    const reconnected = waitForEvent(active, "reconnected");

    server.close();

    // 退避 1s 后建立新 socket，再完成一次完整协商
    await vi.waitFor(() => expect(stats.connections).toBe(2), {
      timeout: 5000,
    });
    await negotiate(await awaitServer(), "juliet@capulet.lit/reconnected");
    await reconnected;

    expect(events).toEqual(["connection:lost", "reconnecting", "reconnected"]);
    // 会话此前已建立：重连成功不再发 session:start
    expect(sessionStarts).toBe(1);
    expect(active.jid.toString()).toBe("juliet@capulet.lit/reconnected");
    expect(active.transport?.status).toBe(Status.BINDED);
  });

  it("重连达到上限：最终触发 session:end 与 disconnect 并停止重连", async () => {
    const active = createConnection({
      reconnect: true,
      reconnectMaxAttempts: 1,
    });
    connection = active;
    const server = await connectAndNegotiate(active);

    const events: string[] = [];
    active.on("session:end", () => events.push("session:end"));
    active.on("disconnect", () => events.push("disconnect"));
    const disconnected = waitForEvent(active, "disconnect");

    server.close();

    // 唯一一次重连尝试：新 socket 建立后立即断开，达到上限
    await vi.waitFor(() => expect(stats.connections).toBe(2), {
      timeout: 5000,
    });
    getServer().close();
    await disconnected;

    expect(events).toEqual(["session:end", "disconnect"]);
    expect(stats.connections).toBe(2);
    expect(active.transport?.status).toBe(Status.DISCONNECTED);
  });
});
