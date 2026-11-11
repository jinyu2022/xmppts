import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../lib/client";
import { Parser } from "../lib/ltx/Parser";
import type { Presence } from "../lib/stanza";
import {
  BIND_SM_FEATURES,
  TCP_TEST_ENDPOINT,
  awaitServer,
  negotiate,
  serverRef,
  stats,
  waitForEvent,
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

/**
 * Client 冒烟测试：装齐默认插件后跑完一次真实会话（mock socket）。
 * 只验证主流程能走通——连接、认证、绑定、会话事件、收发、断开，
 * 协议细节由各模块自己的测试覆盖。默认插件全部登记会触发自动依赖解析
 * （如 XEP0402 → XEP0163/XEP0060）与各插件的 session:start 行为，这类装配
 * 问题只有在完整会话里才会暴露。
 */

/** 用户 JID 与对端 JID（沿用 XEP 常用命名） */
const SELF = "juliet@capulet.lit/balcony";
const PEER = "romeo@montague.lit/orchard";

/**
 * 应答各默认插件在会话建立后发出的查询：
 * XEP-0030 的服务器 disco#info（XEP-0199/XEP-0280 复用同一请求）与 XEP-0402 的书签检索。
 * 不应答会让请求挂到断开时才被清理，主流程就不算完整走通。
 */
async function answerStartupIqs(server: MockServer): Promise<void> {
  const disco = Parser.parse(
    await waitForReceived(server, "http://jabber.org/protocol/disco#info"),
  );
  server.send(`<iq xmlns="jabber:client" type="result" id="${disco.getAttribute("id")}" from="capulet.lit">
    <query xmlns="http://jabber.org/protocol/disco#info">
      <identity category="server" type="im" name="Shakespeare IM"/>
      <feature var="urn:xmpp:ping"/>
    </query>
  </iq>`);

  const bookmarks = Parser.parse(
    await waitForReceived(server, "urn:xmpp:bookmarks:1"),
  );
  server.send(`<iq xmlns="jabber:client" type="result" id="${bookmarks.getAttribute("id")}" from="${SELF}">
    <pubsub xmlns="http://jabber.org/protocol/pubsub">
      <items node="urn:xmpp:bookmarks:1"/>
    </pubsub>
  </iq>`);
}

describe("Client 冒烟（默认插件 + 完整会话）", () => {
  /** 当前用例的客户端，供 afterEach 清理 */
  let client: Client | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    serverRef.current = null;
    stats.connections = 0;
    client = undefined;
  });

  afterEach(() => {
    try {
      client?.disconnect();
    } catch {
      // 已断开时无需处理
    }
  });

  it("构造时自动登记 RFC6121，不依赖 registerDefaultPlugins", () => {
    const active = new Client(SELF, "test123", { ...TCP_TEST_ENDPOINT });
    client = active;
    // 插件表是私有的，这里只验证已登记；实例化在 connect() 内部完成
    const pending = (
      active as unknown as { pendingPlugins: Map<string, unknown> }
    ).pendingPlugins;
    expect(pending.has("RFC6121")).toBe(true);
    expect(active.RFC6121).toBeUndefined();
  });

  it("装齐默认插件后完成会话、收发 stanza 并断开", async () => {
    const active = new Client(SELF, "test123", { ...TCP_TEST_ENDPOINT });
    client = active;
    active.registerDefaultPlugins();

    const started = waitForEvent(active, "session:start");
    await active.connect();
    const server = await awaitServer();
    await negotiate(server, SELF, BIND_SM_FEATURES);
    await started;

    // 默认插件全部实例化并挂到连接上
    expect(active.RFC6121).toBeDefined();
    expect(active.XEP0030).toBeDefined();
    expect(active.XEP0198).toBeDefined();
    expect(active.XEP0280).toBeDefined();
    expect(active.XEP0402).toBeDefined();

    // XEP-0198 §3：绑定后自动发出 <enable/>，应答后流管理启用
    const enable = Parser.parse(await waitForReceived(server, "<enable"));
    expect(enable.namespaceURI).toBe("urn:xmpp:sm:3");
    server.send(`<enabled xmlns="urn:xmpp:sm:3" id="sm-1"/>`);

    // 会话启动期各插件的自发查询得到应答后才算完整会话
    await answerStartupIqs(server);

    // 发消息：经过真实 Connection 的校验、发送管线与写出终端
    active.sendMsg(PEER, "hello", "chat");
    const message = Parser.parse(await waitForReceived(server, "<message"));
    expect(message.getAttribute("to")).toBe(PEER);
    expect(message.getAttribute("type")).toBe("chat");
    expect(message.getElementsByTagName("body")[0].textContent).toBe("hello");

    // 收 presence：经过接收管线与 stanza 路由后派发为高层事件
    const presenceEvent = new Promise<Presence>((resolve) => {
      active.once("presence", resolve);
    });
    server.send(
      `<presence xmlns="jabber:client" from="${PEER}" to="${SELF}"><show>online</show></presence>`,
    );
    const presence = await presenceEvent;
    expect(presence.from.toString()).toBe(PEER);

    // 主动断开：会话状态与传输一并释放
    active.disconnect();
    expect(active.isSessionActive).toBe(false);
    expect(active.transport).toBeNull();
  });
});
