import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { JID } from "../lib/JID";
import { Parser } from "../lib/ltx/Parser";
import { Status } from "../lib/transport/typing";

import {
  getServer,
  serverRef,
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

import XMPPConnection from "../lib/transport/tcp";

/** 测试用的 JID（带资源标识符） */
const TEST_JID = new JID("juliet@capulet.lit/balcony");
/** 测试用的密码 */
const TEST_PASSWORD = "test123";
/** 测试用的服务端地址（TCP 直连模式） */
const SERVER_URL = "tcp://localhost:5222";

/** 包含 PLAIN 认证机制的 stream features，模拟服务端在流协商第一阶段返回。 */
const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

/** 同时宣告 starttls 与 PLAIN 认证机制的 stream features，用于验证 STARTTLS 升级。 */
const STARTTLS_AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <starttls xmlns="urn:ietf:params:xml:ns:xmpp-tls">
    <required/>
  </starttls>
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

const SCRAM_AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
    <mechanism>SCRAM-SHA-1</mechanism>
  </mechanisms>
</stream:features>`;

/** 包含资源绑定的 stream features，模拟服务在 SASL 认证后返回。 */
const BIND_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>`;

/**
 * 等待客户端触发指定事件，返回 Promise.
 * @param client - XMPP 连接实例.
 * @param event - 期望等待的事件名.
 * @returns 解析为事件携带的数据的 Promise.
 */
function waitForEvent<T>(
  client: XMPPConnection,
  event: "authenticated" | "binded" | "stanza" | "stream:start" | "stream:end" | "close" | "error",
): Promise<T> {
  return new Promise((resolve) => client.once(event, resolve as never));
}

function createScramServerExchange(clientAuthBase64: string) {
  const clientFirstMessage = Buffer.from(clientAuthBase64, "base64").toString();
  if (!clientFirstMessage.startsWith("n,,")) {
    throw new Error(`无效的 SCRAM 首条消息：${clientFirstMessage}`);
  }

  const clientFirstBare = clientFirstMessage.slice(3);
  const clientNonce = /(?:^|,)r=([^,]+)/.exec(clientFirstBare)?.[1];
  if (!clientNonce) throw new Error("SCRAM 首条消息缺少客户端 nonce");

  const salt = Buffer.from("fixed-test-salt", "utf8");
  const serverFirst = `r=${clientNonce}fixed-server-nonce,s=${salt.toString("base64")},i=4096`;
  const clientFinalBare = `c=biws,r=${clientNonce}fixed-server-nonce`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalBare}`;

  const saltedPassword = pbkdf2Sync(TEST_PASSWORD, salt, 4096, 20, "sha1");
  const clientKey = createHmac("sha1", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha1").update(clientKey).digest();
  const clientSignature = createHmac("sha1", storedKey)
    .update(authMessage)
    .digest();
  const clientProof = Buffer.from(
    clientKey.map((byte, index) => byte ^ clientSignature[index]),
  ).toString("base64");
  const serverKey = createHmac("sha1", saltedPassword)
    .update("Server Key")
    .digest();
  const serverSignature = createHmac("sha1", serverKey)
    .update(authMessage)
    .digest("base64");

  return {
    challenge: Buffer.from(serverFirst).toString("base64"),
    expectedResponse: Buffer.from(
      `${clientFinalBare},p=${clientProof}`,
    ).toString("base64"),
    success: Buffer.from(`v=${serverSignature}`).toString("base64"),
  };
}

/**
 * 建立 Mock TCP 连接并返回 Mock 服务端句柄.
 * @param client - XMPP 连接实例.
 * @returns 可用于模拟服务端行为的 MockServer 实例.
 */
async function connectClient(client: XMPPConnection): Promise<MockServer> {
  await client.connect(SERVER_URL);
  return getServer();
}

/**
 * 完成完整的 XMPP 握手流程：TCP 连接 → 流协商 → SASL 认证 → 资源绑定.
 * 握手成功后可通过返回的 server 收发自定义 XML.
 * @param client - XMPP 连接实例.
 * @param boundJid - 资源绑定成功后服务端返回的完整 JID，默认 juliet@capulet.lit/server-resource.
 * @returns 握手完成后的 MockServer 实例.
 */
async function completeHandshake(
  client: XMPPConnection,
  boundJid = "juliet@capulet.lit/server-resource",
): Promise<MockServer> {
  // ---- 第一步：TCP 连接与初始流协商 ----
  const server = await connectClient(client);

  server.acceptConnection();
  server.expectReceived("<stream:stream");

  // ---- 第二步：SASL 认证（PLAIN 机制） ----
  server.send(AUTH_FEATURES);
  await waitForReceived(server, "<auth");

  // 等待客户端触发 authenticated 事件后再发送新流
  const authenticated = waitForEvent(client, "authenticated");
  server.send(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
  await authenticated;
  server.expectReceived("<stream:stream");

  // ---- 第三步：资源绑定 ----
  server.send(BIND_FEATURES);
  const bindRequest = Parser.parse(await waitForReceived(server, "<iq"));
  const bindId = bindRequest.getAttribute("id");
  if (!bindId) throw new Error("资源绑定请求缺少 id 属性");

  // 发送资源绑定成功响应，携带服务端分配的完整 JID
  const binded = waitForEvent(client, "binded");
  server.send(`<iq xmlns="jabber:client" id="${bindId}" type="result">
    <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
      <jid>${boundJid}</jid>
    </bind>
  </iq>`);
  await binded;

  return server;
}

/**
 * XMPPConnection（tcp-connection）传输层集成测试.
 * 使用 Mock Socket 模拟服务端，验证连接、认证、资源绑定、消息收发、
 * 错误处理及断开连接等完整生命周期.
 */
describe("XMPPConnection 传输层集成测试", () => {
  let client: XMPPConnection;

  // 每个测试前重置 Mock 状态并创建新的客户端实例（非 TLS 模式）
  beforeEach(() => {
    vi.clearAllMocks();
    serverRef.current = null;
    client = new XMPPConnection(TEST_JID, TEST_PASSWORD, false);
  });

  // 每个测试后尝试断开连接，确保不残留 socket 和事件监听器
  afterEach(() => {
    try {
      client.disconnect();
    } catch {
      // 未建立连接时无需断开
    }
  });

  /**
   * 验证完整的 XMPP 握手流程：
   * 1. 发送初始流头，携带目标域
   * 2. 收到 auth features 后发起 PLAIN 认证
   * 3. 收到 success 后重新发送流头
   * 4. 收到 bind features 后发送资源绑定 IQ
   * 5. 验证最终状态为 BINDED，JID 为服务端分配的值
   */
  it("按协议完成连接、PLAIN 认证和资源绑定", async () => {
    const server = await connectClient(client);

    // 验证初始流头包含目标域
    server.acceptConnection();
    expect(server.expectReceived("<stream:stream")).toContain(
      'to="capulet.lit"',
    );

    // 验证客户端使用 PLAIN 机制发起认证
    server.send(AUTH_FEATURES);
    const auth = Parser.parse(await waitForReceived(server, "<auth"));
    expect(auth.getAttribute("mechanism")).toBe("PLAIN");

    // 发送 SASL 成功响应，等待客户端触发 authenticated 事件
    const authenticated = waitForEvent<void>(client, "authenticated");
    server.send(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
    await authenticated;
    server.expectReceived("<stream:stream");

    // 验证资源绑定请求的格式
    server.send(BIND_FEATURES);
    const bindRequest = Parser.parse(await waitForReceived(server, "<iq"));
    expect(bindRequest.getAttribute("type")).toBe("set");
    expect(bindRequest.getElementsByTagName("resource")[0]?.textContent).toBe(
      "balcony",
    );

    // 发送资源绑定成功响应
    const bindId = bindRequest.getAttribute("id");
    if (!bindId) throw new Error("资源绑定请求缺少 id 属性");

    const binded = waitForEvent<void>(client, "binded");
    server.send(`<iq xmlns="jabber:client" id="${bindId}" type="result">
      <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
        <jid>juliet@capulet.lit/server-resource</jid>
      </bind>
    </iq>`);
    await binded;

    // 验证最终状态和 JID
    expect(client.status).toBe(Status.BINDED);
    expect(client.jid.toString()).toBe("juliet@capulet.lit/server-resource");
  });

  // 资源名可能含 XML 特殊字符，绑定请求必须转义，避免注入（RFC 6120 §7.7.1）
  it("转义资源绑定请求中的资源名", async () => {
    const escapedClient = new XMPPConnection(
      new JID("juliet@capulet.lit/bad</resource><x/>"),
      TEST_PASSWORD,
      false,
    );
    const server = await connectClient(escapedClient);

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(AUTH_FEATURES);
    await waitForReceived(server, "<auth");

    const authenticated = waitForEvent(escapedClient, "authenticated");
    server.send(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
    await authenticated;
    server.expectReceived("<stream:stream");
    server.send(BIND_FEATURES);

    const xml = await waitForReceived(server, "<iq");
    expect(xml).toContain("&lt;/resource&gt;&lt;x/&gt;");
    expect(xml).not.toContain("</resource><x/>");
    escapedClient.disconnect();
  });

  it("使用真实 SCRAM-SHA-1 挑战、证明和服务端签名完成认证", async () => {
    const server = await connectClient(client);

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(SCRAM_AUTH_FEATURES);

    const auth = Parser.parse(await waitForReceived(server, "<auth"));
    expect(auth.getAttribute("mechanism")).toBe("SCRAM-SHA-1");
    const exchange = createScramServerExchange(auth.textContent);

    server.send(
      `<challenge xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${exchange.challenge}</challenge>`,
    );

    let responseXml = "";
    await vi.waitFor(() => {
      responseXml = server.expectReceived("<response");
    });
    const response = Parser.parse(responseXml);
    expect(response.textContent).toBe(exchange.expectedResponse);

    const authenticated = waitForEvent<void>(client, "authenticated");
    server.send(
      `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${exchange.success}</success>`,
    );
    await authenticated;

    server.expectReceived("<stream:stream");
    expect(client.status).toBe(Status.AUTHENTICATED);
  });

  /**
   * 验证握手完成后客户端与服务端可以双向收发 XML stanza：
   * - 客户端发送 message 给好友，服务端能收到并解析
   * - 服务端发送 message 给客户端，客户端触发 stanza 事件并解析正确
   */
  it("客户端与服务端可以双向收发 XML", async () => {
    const server = await completeHandshake(client);

    // ---- 客户端 → 服务端：发送 message ----
    client.send(`<message to="romeo@montague.lit/orchard"><body>你好</body></message>`);
    const outgoing = Parser.parse(server.expectReceived("<message"));
    expect(outgoing.getElementsByTagName("body")[0]?.textContent).toBe("你好");

    // ---- 服务端 → 客户端：发送 message ----
    const incoming = waitForEvent<ReturnType<typeof Parser.parse>>(
      client,
      "stanza",
    );
    server.send(`<message xmlns="jabber:client" from="romeo@montague.lit/orchard">
      <body>收到</body>
    </message>`);

    const stanza = await incoming;
    expect(stanza.getAttribute("from")).toBe("romeo@montague.lit/orchard");
    expect(stanza.getElementsByTagName("body")[0]?.textContent).toBe("收到");
  });

  /**
   * 验证服务端返回 SASL 认证失败时：
   * - 客户端触发 error 事件
   * - 错误消息包含失败原因（not-authorized）
   */
  it("服务端拒绝认证时向客户端报告错误", async () => {
    const server = await connectClient(client);
    const error = waitForEvent<Error>(client, "error");

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(AUTH_FEATURES);
    await waitForReceived(server, "<auth");
    server.send(`<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
      <not-authorized/>
    </failure>`);

    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining("not-authorized") as string,
    });
  });

  /**
   * 验证服务端在流协商阶段发送 stream error 时：
   * - 客户端触发 error 事件
   * - 错误消息包含具体的策略违规原因（policy-violation）
   */
  it("服务端发送 stream error 时向客户端报告错误", async () => {
    const server = await connectClient(client);
    const error = waitForEvent<Error>(client, "error");

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(`<stream:error xmlns:stream="http://etherx.jabber.org/streams">
      <policy-violation xmlns="urn:ietf:params:xml:ns:xmpp-streams"/>
    </stream:error>`);

    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining("policy-violation") as string,
    });
  });

  /**
   * 验证服务端流头上声明的命名空间会被顶层元素继承：
   * <stream:error> 自身不带 xmlns:stream，只能靠流头声明解析出 stream 命名空间。
   */
  it("服务端流头声明的命名空间可被顶层元素继承", async () => {
    const server = await connectClient(client);
    const error = waitForEvent<Error>(client, "error");

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(
      `<stream:stream xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams" from="capulet.lit" id="h1" version="1.0">`,
    );
    server.send(
      `<stream:error><policy-violation xmlns="urn:ietf:params:xml:ns:xmpp-streams"/></stream:error>`,
    );

    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining("policy-violation") as string,
    });
  });

  /**
   * 验证收到服务端流尾（</stream:stream>）时：
   * - 客户端按 RFC 6120 §4.4 回发流尾
   * - 触发 stream:end 与 close，最终状态切换为 DISCONNECTED
   */
  it("收到服务端流尾时回发流尾并关闭连接", async () => {
    const server = await completeHandshake(client);
    const streamEnded = waitForEvent<void>(client, "stream:end");
    const closed = waitForEvent<void>(client, "close");

    server.send("</stream:stream>");

    await waitForReceived(server, "</stream:stream>");
    await Promise.all([streamEnded, closed]);
    expect(client.status).toBe(Status.DISCONNECTED);
  });

  /**
   * 验证服务端断开 TCP 连接时：
   * - 客户端先触发 stream:end 事件（会话关闭）
   * - 再触发 close 事件（连接关闭）
   * - 最终状态切换为 DISCONNECTED
   */
  it("服务端断开连接时结束会话", async () => {
    const server = await completeHandshake(client);
    const streamEnded = waitForEvent<void>(client, "stream:end");
    const closed = waitForEvent<void>(client, "close");

    server.close();

    await Promise.all([streamEnded, closed]);
    expect(client.status).toBe(Status.DISCONNECTED);
  });

  /**
   * 验证底层 socket 发生错误时：
   * - 客户端触发 error 事件
   * - 错误消息透传 socket 的 Error 对象
   */
  it("Socket 错误会传递给客户端", async () => {
    const server = await connectClient(client);
    const error = waitForEvent<Error>(client, "error");

    server.fail(new Error("连接被拒绝"));

    await expect(error).resolves.toMatchObject({ message: "连接被拒绝" });
  });

  /**
   * 验证 TLS 模式下：
   * - 服务端宣告 starttls 后客户端发送 <starttls/> 请求
   * - 收到 <proceed/> 后通过 tls.connect 升级（携带 servername 与 ALPN 协议）
   * - TLS 握手完成后重启流
   */
  it("TLS 模式通过 STARTTLS 升级建立连接", async () => {
    client = new XMPPConnection(TEST_JID, TEST_PASSWORD, true);

    const server = await connectClient(client);
    server.acceptConnection();
    server.expectReceived("<stream:stream");

    // 服务端宣告 starttls（required），客户端应发送 <starttls/> 请求
    server.send(STARTTLS_AUTH_FEATURES);
    await waitForReceived(server, "<starttls");

    // 服务端同意升级，客户端应通过 tls.connect 包装现有 socket
    const upgraded = waitForEvent<void>(client, "stream:start");
    server.send(`<proceed xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>`);

    // tls.connect 创建了新 socket，需重新获取对应的 Mock 服务端并完成 TLS 握手
    const tlsServer = await vi.waitFor(() => {
      const current = getServer();
      if (current !== server) return current;
      throw new Error("TLS socket 尚未创建");
    });
    tlsServer.secureConnect();
    await upgraded;

    expect(tlsConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        // SNI 取 JID 域名而非连接地址（tcp.ts upgradeToTLS）
        servername: "capulet.lit",
        ALPNProtocols: ["xmpp-client"],
      }),
    );

    // TLS 建立后客户端重启流，继续协商
    tlsServer.expectReceived("<stream:stream");
  });

  /**
   * 验证 STARTTLS 升级后的完整握手（TLS 通道上 SASL 认证 + 资源绑定）。
   * 回归用例：曾因 STARTTLS 升级后 parser tree 监听器重复注册，导致二次流特性
   * 被当作 bind 响应处理而断开连接。
   */
  it("TLS 模式完整握手（STARTTLS → SASL → 资源绑定）", async () => {
    client = new XMPPConnection(TEST_JID, TEST_PASSWORD, true);

    const server = await connectClient(client);
    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(STARTTLS_AUTH_FEATURES);
    await waitForReceived(server, "<starttls");
    server.send(`<proceed xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>`);

    // tls.connect 创建新 socket，等待 TLS 握手完成后重启流
    const tlsServer = await vi.waitFor(() => {
      const current = getServer();
      if (current !== server) return current;
      throw new Error("TLS socket 尚未创建");
    });
    tlsServer.secureConnect();
    await waitForReceived(tlsServer, "<stream:stream");

    // TLS 通道上直接进入 SASL 认证（无 starttls 决策）
    tlsServer.send(AUTH_FEATURES);
    const auth = Parser.parse(await waitForReceived(tlsServer, "<auth"));
    expect(auth.getAttribute("mechanism")).toBe("PLAIN");

    const authenticated = waitForEvent<void>(client, "authenticated");
    tlsServer.send(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
    await authenticated;
    tlsServer.expectReceived("<stream:stream");

    // 认证后二次流特性：资源绑定
    tlsServer.send(BIND_FEATURES);
    const bindRequest = Parser.parse(await waitForReceived(tlsServer, "<iq"));
    const bindId = bindRequest.getAttribute("id");
    if (!bindId) throw new Error("资源绑定请求缺少 id 属性");
    const binded = waitForEvent<void>(client, "binded");
    tlsServer.send(`<iq xmlns="jabber:client" id="${bindId}" type="result">
      <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
        <jid>juliet@capulet.lit/server-resource</jid>
      </bind>
    </iq>`);
    await binded;

    // 验证最终状态和 JID
    expect(client.status).toBe(Status.BINDED);
    expect(client.jid.toString()).toBe("juliet@capulet.lit/server-resource");
  });

  /**
   * 验证 TLS 模式下服务器未宣告 starttls 时拒绝降级：
   * - 客户端触发 error 事件
   * - 错误消息提示服务器未宣告 starttls 功能
   */
  it("TLS 模式但服务器未宣告 starttls 时拒绝降级", async () => {
    client = new XMPPConnection(TEST_JID, TEST_PASSWORD, true);

    const server = await connectClient(client);
    const error = waitForEvent<Error>(client, "error");

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(AUTH_FEATURES);

    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining("未宣告 starttls") as string,
    });
  });

  /**
   * 验证 TCP 连接超时（30 秒未建立）时：
   * - 客户端触发 error 事件（TimeoutError）
   * - 连接被断开，状态回到 DISCONNECTED（不再永久停留在 CONNECTING）
   */
  it("TCP 连接超时（30 秒未建立）时报告错误并断开", async () => {
    const error = waitForEvent<Error>(client, "error");

    // 在 fake timers 内执行 connect()，让连接超时定时器受控便于快进
    vi.useFakeTimers();
    try {
      await client.connect(SERVER_URL);
      vi.advanceTimersByTime(30_000);
    } finally {
      vi.useRealTimers();
    }

    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining("连接超时") as string,
    });
    expect(client.status).toBe(Status.DISCONNECTED);
  });

  /**
   * 验证断开后可重新连接：
   * - disconnect() 后 socket 被置空，状态回到 DISCONNECTED
   * - 二次 connect() 创建全新 socket 并完成完整握手
   * （回归用例：曾因复用已销毁的旧 socket 导致重连失败）
   */
  it("断开后可重新连接并完成完整握手", async () => {
    const firstServer = await completeHandshake(client);
    expect(client.status).toBe(Status.BINDED);

    client.disconnect();
    expect(client.status).toBe(Status.DISCONNECTED);

    // 二次连接：应创建全新 socket（对应新的 Mock 服务端实例）
    const secondServer = await completeHandshake(
      client,
      "juliet@capulet.lit/reconnected",
    );
    expect(secondServer).not.toBe(firstServer);
    expect(client.status).toBe(Status.BINDED);
    expect(client.jid.toString()).toBe("juliet@capulet.lit/reconnected");

    // 新连接上仍可正常收发
    client.send(`<message to="romeo@montague.lit/orchard"><body>重连成功</body></message>`);
    const outgoing = Parser.parse(secondServer.expectReceived("<message"));
    expect(outgoing.getElementsByTagName("body")[0]?.textContent).toBe("重连成功");
  });

  /**
   * 验证 BINDING 窗口内 id 不匹配的 IQ result（如插件 ping/disco 的响应）：
   * - 不被误判为 bind 响应（回归用例：曾误判触发断连）
   * - 作为普通 stanza 分发，状态保持 BINDING
   * - 后续 id 匹配的 bind 响应仍可正常完成绑定
   */
  it("BINDING 期间 id 不匹配的 IQ 作为普通 stanza 分发", async () => {
    const server = await connectClient(client);

    server.acceptConnection();
    server.expectReceived("<stream:stream");
    server.send(AUTH_FEATURES);
    await waitForReceived(server, "<auth");

    const authenticated = waitForEvent<void>(client, "authenticated");
    server.send(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
    await authenticated;
    server.expectReceived("<stream:stream");

    server.send(BIND_FEATURES);
    const bindRequest = Parser.parse(await waitForReceived(server, "<iq"));
    const bindId = bindRequest.getAttribute("id");
    if (!bindId) throw new Error("资源绑定请求缺少 id 属性");

    // id 不匹配的 IQ result：应作为普通 stanza 分发而非消费
    const dispatched = waitForEvent<{ getAttribute(name: string): string | null }>(
      client,
      "stanza",
    );
    server.send(`<iq xmlns="jabber:client" id="not-the-bind-id" type="result"/>`);
    expect((await dispatched).getAttribute("id")).toBe("not-the-bind-id");
    expect(client.status).toBe(Status.BINDING);

    // 后续正确的 bind 响应仍能完成绑定
    const binded = waitForEvent<void>(client, "binded");
    server.send(`<iq xmlns="jabber:client" id="${bindId}" type="result">
      <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
        <jid>juliet@capulet.lit/other</jid>
      </bind>
    </iq>`);
    await binded;

    expect(client.jid.toString()).toBe("juliet@capulet.lit/other");
  });

  /**
   * 验证 connect() 重入保护：
   * - 入口即检查并同步占位 CONNECTING，第二次调用立即失败（不再越过守卫）
   * - 仅创建一个 socket，不会因并发调用泄漏双 socket
   */
  it("connect 重复调用立即失败且不泄漏双 socket", async () => {
    const first = client.connect(SERVER_URL);

    // 首次调用已同步占位为 CONNECTING，二次调用应在守卫处立即失败
    expect(client.status).toBe(Status.CONNECTING);
    await expect(client.connect(SERVER_URL)).rejects.toThrow(
      "连接已在进行中",
    );

    await first;
    expect(client.status).toBe(Status.CONNECTING);
    expect(Socket).toHaveBeenCalledTimes(1);
  });
});