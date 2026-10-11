import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { Status } from "../../../lib/transport/typing";
import XEP0368 from "../../../lib/plugins/xep0368";
import logger from "../../../lib/log";

logger.setLevel("debug");

/**
 * XEP-0368: SRV records for XMPP over TLS
 * @see https://xmpp.org/extensions/xep-0368.html
 * @version 1.1.0 (2019-08-20)
 *
 * 直连 TLS 链路测试：SRV 解析使用真实记录（conversations.im），
 * 网络层使用 mock socket（node:net / node:tls），无真实 TCP/TLS 连接。
 */
const DOMAIN = "conversations.im";
/** 测试不进行 SASL 认证，密码仅为占位 */
const TEST_PASSWORD = "unused";

/** Mock 服务端接口，用于模拟底层 socket 事件。 */
interface MockServer {
  /** 当前模拟 socket（encrypted=true 模拟 TLSSocket，false 为明文） */
  socket: { encrypted: boolean; received: string[] };
  /** 模拟底层连接建立（net "connect" 事件）。 */
  acceptConnection(): void;
  /** 模拟 TLS 握手完成（TLSSocket "secureConnect" 事件，仅直连 TLS 使用）。 */
  secureConnect(): void;
  /** 模拟服务端向客户端发送 XML 数据。 */
  send(xml: string): void;
  /** 检查客户端发来的首个 XML 是否包含期望片段。 */
  expectReceived(expected: string): string;
}

/**
 * 创建 Mock Socket 工厂和 Mock 服务端引用。
 * 在 vi.hoisted 中提升到模块最顶层，确保 vi.mock 能直接引用。
 */
const { createMockSocket, serverRef } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const ref: { current: MockServer | null } = { current: null };

  class MockSocket extends EventEmitter {
    readonly received: string[] = [];
    /** encrypted=true 模拟 TLSSocket（直连 TLS 注入），false 为明文 net.Socket */
    readonly encrypted: boolean;

    constructor(encrypted = false) {
      super();
      this.encrypted = encrypted;
    }

    setEncoding() {}
    setTimeout() {}
    connect() {}

    end() {
      this.emit("close");
    }

    write(xml: string): boolean {
      this.received.push(xml);
      return true;
    }
  }

  function createSocket(encrypted = false) {
    const socket = new MockSocket(encrypted);
    ref.current = {
      socket,
      acceptConnection() {
        socket.emit("connect");
      },
      secureConnect() {
        socket.emit("secureConnect");
      },
      send(xml: string) {
        socket.emit("data", Buffer.from(xml));
      },
      expectReceived(expected: string) {
        const xml = socket.received.shift();
        if (xml === undefined) {
          throw new Error(`客户端没有发送 XML，期望收到：${expected}`);
        }
        if (!xml.includes(expected)) {
          throw new Error(`客户端发送的 XML 不符合预期：${xml}`);
        }
        return xml;
      },
    };
    return socket;
  }

  return { createMockSocket: createSocket, serverRef: ref };
});

// 明文 socket：替换 node:net.Socket
vi.mock("node:net", () => ({
  Socket: vi.fn().mockImplementation(function () { return createMockSocket(false); }),
}));

// 直连 TLS socket：替换 node:tls.connect；
// TLSSocket 保留真实导出（upgradeToTLS 的 instanceof 判断依赖它）
vi.mock("node:tls", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:tls")>();
  return {
    connect: vi.fn().mockImplementation(() => createMockSocket(true)),
    TLSSocket: mod.TLSSocket,
  };
});

/** 已建立连接的引用，供 afterEach 统一断开 */
const active = new Set<Connection>();

describe("XEP0368 直连 TLS", () => {
  afterEach(() => {
    for (const conn of active) {
      conn.transport?.disconnect();
    }
    active.clear();
    serverRef.current = null;
    // 只清调用记录，不清 mock 实现（restoreAllMocks 会清掉 factory 的 mockImplementation）
    vi.clearAllMocks();
  });

  it("SRV 服务名与回退服务符合 §3", () => {
    expect(XEP0368.SRV_SERVICE).toBe("_xmpps-client._tcp");
    expect(XEP0368.FALLBACK_SERVICE).toBe("_xmpp-client._tcp");
  });

  it("resolveDirectTLS 解析出真实 _xmpps-client SRV 端点", async () => {
    const endpoints = await XEP0368.resolveDirectTLS(DOMAIN);
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0].host.length).toBeGreaterThan(0);
    expect(endpoints[0].port).toBeGreaterThan(0);
  });

  it("从初始连接开始，直连 TLS 握手后直接进入 SASL 认证", async () => {
    // 固定 SRV 解析结果，隔离真实 DNS/网络
    vi.spyOn(XEP0368, "resolveDirectTLS").mockResolvedValue([
      { host: "xmpps.mock.example", port: 443 },
    ]);
    const conn = new Connection(`xep0368-test@${DOMAIN}`, TEST_PASSWORD, {
      protocol: "xmpp",
    });
    active.add(conn);
    conn.registerPlugin("XEP0368");
    // 初始连接：不提供 url，由 XEP0368 在 beforeConnect 阶段解析 SRV 并注入 TLSSocket
    await conn.connect();
    const transport = conn.transport;
    expect(transport).not.toBeNull();

    // 等待注入与 connect() 同步段落盘（beforeConnect 微任务链）
    await vi.waitFor(() => expect(serverRef.current).not.toBeNull());
    // 排空微任务：确保 setupSocketListeners 的 "connect" 监听已注册
    await new Promise<void>((resolve) => setImmediate(resolve));
    const server = serverRef.current!;
    // 注入的是"加密" socket（模拟 TLSSocket），传输层未创建明文 Socket
    expect(server.socket.encrypted).toBe(true);

    // 先挂监听再触发连接：避免事件早于注册而丢失
    const connected = new Promise<void>((resolve) =>
      conn.once("connect", () => resolve()),
    );
    server.acceptConnection();
    await connected;
    // 底层连接建立：open 触发、流头发出，此时握手未完成 → STREAM_START
    expect(transport?.status).toBe(Status.STREAM_START);
    expect(server.expectReceived("<stream:stream")).toContain(DOMAIN);

    // 模拟 TLS 握手完成：XEP0368 的 secureConnect 监听置 TLS_ESTABLISHED
    server.secureConnect();
    expect(transport?.status).toBe(Status.TLS_ESTABLISHED);

    // TLS 就绪后的流特性：route 走 mechanisms 分支，直接发起 SASL 认证
    server.send(
      `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
        <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
          <mechanism>PLAIN</mechanism>
        </mechanisms>
      </stream:features>`,
    );
    await vi.waitFor(() =>
      expect(transport?.status).toBe(Status.AUTHENTICATING),
    );
    // 卡死回归断言：认证请求必须已发出（旧实现止步于 TLS_ESTABLISHED，auth 永不发送）
    expect(server.expectReceived("<auth")).toContain("PLAIN");
  });

  it("protocol xmpp + tls: false 时走明文 TCP（XEP0368 不介入）", async () => {
    const conn = new Connection(`xep0368-test@${DOMAIN}`, TEST_PASSWORD, {
      protocol: "xmpp",
      tls: false,
    });
    active.add(conn);
    conn.registerPlugin("XEP0368");
    await conn.connect();
    const transport = conn.transport;
    expect(transport).not.toBeNull();

    // ctx.tls=false → XEP0368 不介入：默认明文 Socket（无需等待 DNS/注入）
    await vi.waitFor(() => expect(serverRef.current).not.toBeNull());
    // 排空微任务：确保 setupSocketListeners 的 "connect" 监听已注册
    await new Promise<void>((resolve) => setImmediate(resolve));
    const server = serverRef.current!;
    expect(server.socket.encrypted).toBe(false);

    // 明文 TCP 建立后发出 open，等待流特性做 STARTTLS 决策
    const connected = new Promise<void>((resolve) =>
      conn.once("connect", () => resolve()),
    );
    server.acceptConnection();
    await connected;
    expect(transport?.status).toBe(Status.STREAM_START);
  });
});