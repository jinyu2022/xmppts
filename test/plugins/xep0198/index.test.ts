import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { Status } from "../../../lib/transport/typing";
import {
  BIND_SM_FEATURES,
  answerBind,
  createTcpConnection,
  getServer,
  negotiateStream,
  serverRef,
  stats,
  waitForEvent,
  waitForReceived,
  type MockServer,
} from "../../helpers/mock-transport";

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

// 将 node:net.Socket 替换为 Mock Socket，避免真实 TCP 连接
vi.mock("node:net", async () => {
  const { netMock } = await import("../../helpers/mock-transport");
  return netMock();
});

/** location 用于让重连跳过 SRV 解析 */
const ENABLE_ATTRS = `id="sid-1" resume="true" location="localhost:5222"`;

/** 服务器在绑定结果中分配的完整 JID */
const BOUND_JID = "test@example.com/server-resource";

/** 取出客户端已发出、包含指定内容的 XML（不存在时返回 undefined）。 */
function takeReceived(server: MockServer, expected: string): string | undefined {
  const index = server.received.findIndex((item) => item.includes(expected));
  if (index < 0) return undefined;
  return server.received.splice(index, 1)[0];
}

/** 应答启用请求 */
async function answerEnable(server: MockServer, attrs = ENABLE_ATTRS) {
  const enable = Parser.parse(await waitForReceived(server, "<enable"));
  expect(enable.getAttribute("resume")).toBe("true");
  server.send(`<enabled xmlns="urn:xmpp:sm:3" ${attrs}/>`);
}

/** 创建已注册 XEP0198 的高层连接（非 TLS，直连 localhost） */
function createConnection(): Connection {
  const connection = createTcpConnection("test@example.com/resource", {
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
  const sessionStart = waitForEvent(connection, "session:start");
  await connection.connect();
  const server = getServer();
  await negotiateStream(server, BIND_SM_FEATURES);
  await answerBind(server, BOUND_JID);
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
  await negotiateStream(reconnected, BIND_SM_FEATURES);
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
    // 用例中途失败时也要恢复真实定时器，避免影响后续用例
    vi.useRealTimers();
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

  it("会话就绪时发出的业务 stanza 排在启用请求之前，且启用请求仍会发出", async () => {
    const active = createConnection();
    connection = active;
    // 用户监听器在 connect() 前注册，插件监听器在 initPlugins() 中注册，故二者顺序为：先业务 stanza、后 <enable/>
    const sessionStart = new Promise<void>((resolve) => {
      active.once("session:start", () => {
        active.send("<presence/>");
        resolve();
      });
    });

    await active.connect();
    const server = getServer();
    await negotiateStream(server, BIND_SM_FEATURES);
    await answerBind(server, BOUND_JID);
    await sessionStart;

    // <enable/> 之前的 stanza 不计入流管理（XEP-0198 §4），但启用请求必须照常发出
    const received = server.received.join("\n");
    const enableAt = received.indexOf("<enable");
    const presenceAt = received.indexOf("<presence");
    expect(enableAt).toBeGreaterThanOrEqual(0);
    expect(presenceAt).toBeGreaterThanOrEqual(0);
    expect(presenceAt).toBeLessThan(enableAt);

    // 结束启用流程，避免残留监听器
    await answerEnable(server);
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

    const restored = waitForEvent(active, "reconnected");
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

    const restored = waitForEvent(active, "reconnected");
    reconnected.send(`<failed xmlns="urn:xmpp:sm:3">
      <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
    </failed>`);

    // 服务端拒绝恢复后应回退到资源绑定，并在绑定后重新启用流管理
    await answerBind(reconnected, BOUND_JID);
    await restored;
    await answerEnable(reconnected);
    expect(active.transport?.status).toBe(Status.BINDED);
  });

  it("本地主动断开时不进行重连", async () => {
    const active = createConnection();
    connection = active;
    await connectWithSm(active);

    const reconnecting = vi.fn();
    active.on("reconnecting", reconnecting);

    // 先启用假定时器：若实现回归成「断开后仍由 close 回调调度重连」，
    // 该定时器会落在可控范围内，下面的推进才能检出它
    vi.useFakeTimers();
    active.disconnect();
    // 推进到远超重连间隔（10ms）的时长，期间不应产生新 socket
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconnecting).not.toHaveBeenCalled();
    expect(stats.connections).toBe(1);
    // 断开同时释放传输引用，断开后的 close 回调不再有目标
    expect(active.transport).toBeNull();
  });
});
