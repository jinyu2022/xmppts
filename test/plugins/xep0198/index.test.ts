import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { Status } from "../../../lib/transport/typing";

/**
 * XEP-0198: Stream Management
 * @see https://xmpp.org/extensions/xep-0198.html
 * @version 1.6.3 (2025-07-28)
 *
 * 端到端测试：使用 Mock Socket 模拟服务端，验证流管理的启用、确认、断线重连与会话恢复。
 * 流特性 sm 元素取自 §2 Example 1；enable/enabled/r/a/resume/resumed/failed 取自
 * §3 Example 2/3/4、§4 Example 7、§5 Example 8/12/13/14。网络层使用 mock socket
 * （node:net），无真实连接。
 */

/** Mock 服务端，用于模拟服务端行为。 */
interface MockServer {
  /** 客户端已发出的 XML */
  received: string[];
  /** 模拟 TCP 连接建立 */
  acceptConnection(): void;
  /** 模拟服务端发送 XML */
  send(xml: string): void;
  /** 模拟服务端断开连接 */
  close(): void;
}

const { createMockSocket, serverRef, stats } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const ref: { current: MockServer | null } = { current: null };
  const counters = { connections: 0 };

  class MockSocket extends EventEmitter {
    readonly received: string[] = [];

    setEncoding() {}
    setTimeout() {}
    connect() {}

    /** 与真实 socket 一致：end() 最终触发 close 事件 */
    end() {
      this.emit("close");
    }

    write(xml: string): boolean {
      this.received.push(xml);
      return true;
    }
  }

  function createSocket() {
    counters.connections++;
    const socket = new MockSocket();
    ref.current = {
      received: socket.received,
      acceptConnection() {
        socket.emit("connect");
      },
      send(xml: string) {
        socket.emit("data", Buffer.from(xml));
      },
      close() {
        socket.emit("close");
      },
    };
    return socket;
  }

  return { createMockSocket: createSocket, serverRef: ref, stats: counters };
});

// 将 node:net.Socket 替换为 Mock Socket，避免真实 TCP 连接
vi.mock("node:net", () => ({
  Socket: vi.fn().mockImplementation(function () { return createMockSocket(); }),
}));

/** 只宣告 PLAIN 认证机制的流特性 */
const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

/** 认证后宣告资源绑定与流管理的流特性 */
const BIND_SM_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
  <sm xmlns="urn:xmpp:sm:3"/>
</stream:features>`;

const SASL_SUCCESS = `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`;

/** location 用于让重连跳过 SRV 解析 */
const ENABLE_ATTRS = `id="sid-1" resume="true" location="localhost:5222"`;

/** 获取当前 Mock 服务端。 */
function getServer(): MockServer {
  if (!serverRef.current) throw new Error("Mock 服务端尚未创建");
  return serverRef.current;
}

/**
 * 等待客户端发送包含期望内容的 XML。
 * 管线化实现经 await next() 后才发送，需轮询等待微任务完成。
 */
async function waitForReceived(
  server: MockServer,
  expected: string,
): Promise<string> {
  let xml = "";
  await vi.waitFor(
    () => {
      const index = server.received.findIndex((item) => item.includes(expected));
      if (index < 0) throw new Error(`客户端未发送：${expected}`);
      xml = server.received.splice(index, 1)[0];
    },
    { timeout: 5000 },
  );
  return xml;
}

/** 取出客户端已发出、包含指定内容的 XML（不存在时返回 undefined）。 */
function takeReceived(server: MockServer, expected: string): string | undefined {
  const index = server.received.findIndex((item) => item.includes(expected));
  if (index < 0) return undefined;
  return server.received.splice(index, 1)[0];
}

/** 推进一次流协商：流头 → PLAIN 认证 → 流重启 → 送出绑定/流管理特性 */
async function negotiate(server: MockServer) {
  server.acceptConnection();
  await waitForReceived(server, "<stream:stream");
  server.send(AUTH_FEATURES);
  await waitForReceived(server, "<auth");
  server.send(SASL_SUCCESS);
  await waitForReceived(server, "<stream:stream");
  server.send(BIND_SM_FEATURES);
}

/** 应答资源绑定请求 */
async function answerBind(server: MockServer) {
  const bind = Parser.parse(await waitForReceived(server, "<iq"));
  server.send(`<iq xmlns="jabber:client" id="${bind.getAttribute("id")}" type="result">
    <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
      <jid>test@example.com/server-resource</jid>
    </bind>
  </iq>`);
}

/** 应答启用请求 */
async function answerEnable(server: MockServer, attrs = ENABLE_ATTRS) {
  const enable = Parser.parse(await waitForReceived(server, "<enable"));
  expect(enable.getAttribute("resume")).toBe("true");
  server.send(`<enabled xmlns="urn:xmpp:sm:3" ${attrs}/>`);
}

/** 等待高层触发会话就绪事件 */
function waitSessionStart(connection: Connection): Promise<void> {
  return new Promise((resolve) => connection.once("session:start", resolve));
}

/** 等待高层触发自动重连成功事件（会话此前已建立，不发 session:start） */
function waitReconnected(connection: Connection): Promise<void> {
  return new Promise((resolve) => connection.once("reconnected", resolve));
}

/** 创建已注册 XEP0198 的高层连接（非 TLS，直连 localhost） */
function createConnection(): Connection {
  const connection = new Connection("test@example.com/resource", "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
    // 恢复用例依赖自动重连，间隔取小值避免拖慢测试
    reconnect: true,
    reconnectInterval: 10,
  });
  connection.registerPlugin("XEP0198");
  return connection;
}

/** 完成「连接 → 认证 → 绑定 → 启用流管理」的完整流程 */
async function connectWithSm(
  connection: Connection,
  enableAttrs = ENABLE_ATTRS,
): Promise<MockServer> {
  const sessionStart = waitSessionStart(connection);
  await connection.connect();
  const server = getServer();
  await negotiate(server);
  await answerBind(server);
  await sessionStart;
  await answerEnable(server, enableAttrs);
  return server;
}

/** 模拟断线并等待插件重连到新的 socket */
async function reconnect(connection: Connection, server: MockServer) {
  server.close();
  await vi.waitFor(() => expect(stats.connections).toBeGreaterThan(1), {
    timeout: 10_000,
  });
  const reconnected = getServer();
  await negotiate(reconnected);
  expect(connection.transport?.status).not.toBe(Status.DISCONNECTED);
  return reconnected;
}

describe("XEP0198 流管理", () => {
  /** 当前用例的连接，供 afterEach 清理 */
  let connection: Connection | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    serverRef.current = null;
    stats.connections = 0;
    connection = undefined;
  });

  afterEach(() => {
    // 断开残留连接，避免定时器与监听器影响后续用例
    try {
      connection?.disconnect();
    } catch {
      // 已断开时无需处理
    }
  });

  it("资源绑定后自动启用流管理，并按间隔请求确认", async () => {
    const active = createConnection();
    connection = active;
    const server = await connectWithSm(active);

    // 发送满 interval 条消息后应请求确认
    for (let i = 0; i < 5; i++) {
      active.send(`<message to="friend@example.com"><body>${i}</body></message>`);
    }
    const ackRequest = Parser.parse(await waitForReceived(server, "<r"));
    expect(ackRequest.namespaceURI).toBe("urn:xmpp:sm:3");

    // 应答确认，清除插件的等待定时器
    server.send(`<a xmlns="urn:xmpp:sm:3" h="5"/>`);
  });

  it("收到服务器的确认请求时回复已处理数量", async () => {
    const active = createConnection();
    connection = active;
    const server = await connectWithSm(active);

    // 先接收一条消息，已处理数量变为 1
    server.send(`<message from="friend@example.com" to="test@example.com/resource">
      <body>hi</body>
    </message>`);
    server.send(`<r xmlns="urn:xmpp:sm:3"/>`);

    const ack = Parser.parse(await waitForReceived(server, "<a"));
    expect(ack.getAttribute("h")).toBe("1");
  });

  it("断线后重连并发送 resume 恢复会话", async () => {
    const active = createConnection();
    connection = active;
    const server = await connectWithSm(active);

    const reconnected = await reconnect(active, server);

    // 应发出 resume 而不是资源绑定请求
    const resume = Parser.parse(await waitForReceived(reconnected, "<resume"));
    expect(resume.getAttribute("previd")).toBe("sid-1");
    expect(resume.getAttribute("h")).toBe("0");
    expect(takeReceived(reconnected, "<iq")).toBeUndefined();

    const restored = waitReconnected(active);
    reconnected.send(`<resumed xmlns="urn:xmpp:sm:3" h="0" previd="sid-1"/>`);
    await restored;
    expect(active.transport?.status).toBe(Status.BINDED);
  });

  it("恢复失败时回退到常规资源绑定", async () => {
    const active = createConnection();
    connection = active;
    const server = await connectWithSm(active);

    const reconnected = await reconnect(active, server);
    await waitForReceived(reconnected, "<resume");

    const restored = waitReconnected(active);
    reconnected.send(`<failed xmlns="urn:xmpp:sm:3">
      <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
    </failed>`);

    // 服务端拒绝恢复后应回退到资源绑定，并在绑定后重新启用流管理
    await answerBind(reconnected);
    await restored;
    await answerEnable(reconnected);
    expect(active.transport?.status).toBe(Status.BINDED);
  });

  it("本地主动断开时不进行重连", async () => {
    const active = createConnection();
    connection = active;
    await connectWithSm(active);

    active.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(stats.connections).toBe(1);
  });
});
