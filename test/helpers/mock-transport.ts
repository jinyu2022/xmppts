import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { Connection, type SocketEventMap } from "../../lib/connection";
import { Parser } from "../../lib/ltx/Parser";
import type { TransportSink } from "../../lib/transport/typing";

/**
 * Mock 服务端句柄：代替真实 XMPP 服务端驱动一次 socket 会话。
 * 每次创建 Mock socket 时重新绑定，通过 serverRef.current 或 getServer() 获取。
 */
export interface MockServer {
  /** 客户端已发出的 XML，取走后从数组移除 */
  received: string[];
  /** 模拟 TCP/TLS 连接建立 */
  acceptConnection(): void;
  /** 模拟服务端发送 XML */
  send(xml: string): void;
  /** 取出客户端已发出的、首个包含期望内容的 XML，不存在时抛错 */
  expectReceived(expected: string): string;
  /** 模拟服务端断开连接 */
  close(): void;
  /** 模拟 socket 错误 */
  fail(error: Error): void;
  /** 模拟 TLS 握手完成 */
  secureConnect(): void;
}

/** 当前 Mock 服务端引用，创建新 socket 时更新 */
export const serverRef: { current: MockServer | null } = { current: null };

/** 累计创建的 socket 数量，用于断言重连是否产生新连接 */
export const stats = { connections: 0 };

/** 假的 net/tls socket：只实现传输层用到的方法与 flag */
class MockSocket extends EventEmitter {
  readonly received: string[] = [];

  setEncoding(): this {
    return this;
  }

  setTimeout(): this {
    return this;
  }

  /** 拨号由测试手动触发（acceptConnection），此处不产生副作用 */
  connect(): this {
    return this;
  }

  /** 与真实 node net.Socket 一致：end() 最终触发 close 事件 */
  end() {
    this.emit("close");
  }

  /** 与真实 node net.Socket 一致：destroy() 触发 close 事件 */
  destroy() {
    this.emit("close");
  }

  write(xml: string): boolean {
    this.received.push(xml);
    return true;
  }
}

/** 创建 Mock socket，并把 serverRef 指向配套的服务端句柄 */
export function createMockSocket(): MockSocket {
  stats.connections += 1;
  const socket = new MockSocket();
  serverRef.current = {
    received: socket.received,
    acceptConnection() {
      socket.emit("connect");
    },
    send(xml: string) {
      socket.emit("data", Buffer.from(xml));
    },
    expectReceived(expected: string) {
      const index = socket.received.findIndex((item) =>
        item.includes(expected),
      );
      if (index < 0) {
        throw new Error(
          `客户端没有发送期望的 XML：${expected}\n已发送：${JSON.stringify(socket.received)}`,
        );
      }
      return socket.received.splice(index, 1)[0];
    },
    close() {
      socket.emit("close");
    },
    fail(error: Error) {
      socket.emit("error", error);
    },
    secureConnect() {
      socket.emit("secureConnect");
    },
  };
  return socket;
}

/**
 * 获取当前 Mock 服务端。
 * @throws 尚未建立连接（没有任何 socket 被创建）时抛出
 */
export function getServer(): MockServer {
  if (!serverRef.current) {
    throw new Error("Mock 服务端尚未创建，请先建立连接");
  }
  return serverRef.current;
}

/** 等待底层 socket 创建并返回对应 Mock 服务端（socket 在 connect() 内的微任务中创建） */
export async function awaitServer(): Promise<MockServer> {
  return await vi.waitFor(() => getServer(), { timeout: 5000 });
}

/**
 * 把传输层的 TransportSink 回调映射成事件。
 * 传输层只通过回调汇报（见 lib/transport/stream-connection.ts），转成 EventEmitter
 * 后可以用 once 等待 binded/stanza/close/error。
 */
export function createSinkEvents(): { sink: TransportSink; events: EventEmitter } {
  const events = new EventEmitter();
  const sink: TransportSink = {
    onBinded: () => events.emit("binded"),
    onStanza: (stanza) => events.emit("stanza", stanza),
    onClose: (closeEvent) => events.emit("close", closeEvent),
    onError: (error) => events.emit("error", error),
  };
  return { sink, events };
}

/** 等待一次高层事件，忽略事件参数 */
export function waitForEvent<T extends keyof SocketEventMap>(
  connection: Connection,
  event: T,
): Promise<void> {
  return new Promise((resolve) => {
    connection.once(event, () => resolve());
  });
}

/**
 * 等待客户端发出包含期望内容的 XML。
 * 管线化实现经 await next() 后才发送，需轮询等待微任务完成。
 */
export async function waitForReceived(
  server: MockServer,
  expected: string,
): Promise<string> {
  let xml = "";
  await vi.waitFor(
    () => {
      xml = server.expectReceived(expected);
    },
    { timeout: 5000 },
  );
  return xml;
}

// ───────────────────────── 会话握手 ─────────────────────────

/** 只宣告 PLAIN 认证机制的流特性 */
export const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

/** 认证成功的 SASL 响应 */
export const SASL_SUCCESS = `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`;

/** 认证后宣告资源绑定的流特性 */
export const BIND_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>`;

/** 认证后宣告资源绑定与流管理的流特性 */
export const BIND_SM_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
  <sm xmlns="urn:xmpp:sm:3"/>
</stream:features>`;

/**
 * 推进流协商到服务器宣告认证后特性（此时客户端尚未发出绑定请求）。
 * @param features 认证后的流特性，默认只宣告资源绑定
 */
export async function negotiateStream(
  server: MockServer,
  features: string = BIND_FEATURES,
): Promise<void> {
  server.acceptConnection();
  await waitForReceived(server, "<stream:stream");
  server.send(AUTH_FEATURES);
  await waitForReceived(server, "<auth");
  server.send(SASL_SUCCESS);
  await waitForReceived(server, "<stream:stream");
  server.send(features);
}

/**
 * 应答客户端的资源绑定请求（取绑定 IQ 的 id 回 result）。
 * @param boundJid 服务器分配的完整 JID
 */
export async function answerBind(
  server: MockServer,
  boundJid: string,
): Promise<void> {
  const bind = Parser.parse(await waitForReceived(server, "<iq"));
  server.send(`<iq xmlns="jabber:client" id="${bind.getAttribute("id")}" type="result">
    <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
      <jid>${boundJid}</jid>
    </bind>
  </iq>`);
}

/**
 * 完成「流协商 → 资源绑定」。
 * @param boundJid 服务器分配的完整 JID
 * @param features 认证后的流特性，默认只宣告资源绑定
 */
export async function negotiate(
  server: MockServer,
  boundJid: string,
  features: string = BIND_FEATURES,
): Promise<void> {
  await negotiateStream(server, features);
  await answerBind(server, boundJid);
}

/** 测试用明文 TCP 端点：localhost:5222，不走 TLS 与 SRV 发现 */
export const TCP_TEST_ENDPOINT = {
  protocol: "xmpp",
  host: "localhost",
  port: 5222,
  tls: false,
} as const;

/**
 * 创建指向测试端点的 Connection（明文 TCP）。
 * 调用方负责注册插件与断开清理。
 * @param jid 客户端 JID
 * @param options 覆盖端点或连接选项（如 reconnect）
 */
export function createTcpConnection(
  jid: string,
  options: NonNullable<ConstructorParameters<typeof Connection>[2]> = {},
): Connection {
  return new Connection(jid, "test123", { ...TCP_TEST_ENDPOINT, ...options });
}

/** vi.mock("node:net") 的工厂返回值 */
export function netMock(): { Socket: () => MockSocket } {
  return {
    Socket: vi.fn().mockImplementation(function () { return createMockSocket(); }),
  };
}

/**
 * vi.mock("node:tls") 的工厂返回值。
 * TLSSocket 保留真实导出：传输层用 instanceof 判断 TLS 就绪。
 */
export async function tlsMock(
  importOriginal: () => Promise<unknown>,
): Promise<{ connect: () => MockSocket; TLSSocket: typeof import("node:tls").TLSSocket }> {
  const mod = (await importOriginal()) as typeof import("node:tls");
  return {
    connect: vi.fn().mockImplementation(() => createMockSocket()),
    TLSSocket: mod.TLSSocket,
  };
}
