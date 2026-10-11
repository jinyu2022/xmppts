import { EventEmitter } from "node:events";
import { vi } from "vitest";

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
