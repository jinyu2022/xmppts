import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WSConnection } from "../../lib/transport/websocket";
import { JID } from "../../lib/JID";
import { Status } from "../../lib/transport/typing";

/**
 * WSConnection 单元测试：以假 WebSocket 类替换 globalThis.WebSocket，不建立真实连接。
 * 覆盖 RFC 7395 framing、SASL/BIND 协商、stanza 转发、关闭与错误路径。
 */

/** 假的浏览器 WebSocket：由测试驱动 open/message/close 事件 */
class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];

  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("尚未创建 WebSocket");
    return ws;
  }

  readyState = 0;
  readonly sent: string[] = [];
  onopen?: () => void;
  onclose?: (ev: CloseEvent) => void;
  onmessage?: (ev: MessageEvent) => void;
  onerror?: () => void;

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("readyState not OPEN");
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "bye" } as CloseEvent);
  }

  // ---- 测试驱动 ----
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  fail(): void {
    this.onerror?.();
  }
}

const RealWebSocket = globalThis.WebSocket;

/** 只宣告 PLAIN 的流特性 */
const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;
const BIND_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>`;
const SASL_SUCCESS = `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`;

/** 建立连接并触发 open（返回假 ws 供后续驱动） */
async function connectOpen() {
  const connection = new WSConnection(new JID("juliet@capulet.lit/balcony"), "secret");
  // WebSocket 端点取自 XEP-0156 Example 1
  await connection.connect("wss://web.example.com:443/ws");
  const ws = FakeWebSocket.last();
  ws.open();
  return { connection, ws };
}

/** 完成 open → PLAIN 认证 → 第二轮流特性 */
async function authenticate(connection: WSConnection, ws: FakeWebSocket) {
  const authenticated = new Promise<void>((resolve) =>
    connection.once("authenticated", resolve),
  );
  ws.message(AUTH_FEATURES);
  await vi.waitFor(() => expect(ws.sent.some((x) => x.includes("<auth"))).toBe(true));
  ws.message(SASL_SUCCESS);
  await authenticated;
}

describe("WSConnection", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = RealWebSocket;
  });

  it("缺少 url 时 connect 抛错", async () => {
    const connection = new WSConnection(new JID("juliet@capulet.lit"), "secret");
    await expect(connection.connect()).rejects.toThrow("missing websocket url");
  });

  it("构造时无 resource 自动生成", () => {
    const connection = new WSConnection(new JID("juliet@capulet.lit"), "secret");
    expect(connection.jid.resource).toBeTruthy();
  });

  it("connect 以 xmpp 子协议建连，open 后发送 framing <open/> 并触发 stream:start", async () => {
    const { connection, ws } = await connectOpen();

    expect(ws.url).toBe("wss://web.example.com:443/ws");
    expect(ws.protocol).toBe("xmpp");
    expect(connection.status).toBe(Status.STREAM_START);
    expect(ws.sent[0]).toMatch(/^<open to="capulet\.lit"/);
    expect(ws.sent[0]).toContain('xmlns="urn:ietf:params:xml:ns:xmpp-framing"');
  });

  it("收到流特性后发起 PLAIN 认证，success 后重启流并触发 authenticated", async () => {
    const { connection, ws } = await connectOpen();
    const events: string[] = [];
    connection.on("stream:start", () => events.push("stream:start"));

    ws.message(AUTH_FEATURES);
    await vi.waitFor(() => expect(ws.sent.some((x) => x.includes("<auth"))).toBe(true));
    expect(connection.status).toBe(Status.AUTHENTICATING);

    const authenticated = new Promise<void>((resolve) =>
      connection.once("authenticated", resolve),
    );
    ws.message(SASL_SUCCESS);
    await authenticated;
    expect(events).toEqual(["stream:start"]);
    expect(ws.sent.filter((x) => x.startsWith("<open"))).toHaveLength(2);
  });

  it("认证后收到 bind 特性发送绑定请求，按 id 匹配结果并采用服务端 JID", async () => {
    const { connection, ws } = await connectOpen();
    await authenticate(connection, ws);

    const binded = new Promise<void>((resolve) => connection.once("binded", resolve));
    ws.message(BIND_FEATURES);
    await vi.waitFor(() => expect(ws.sent.some((x) => x.includes("<iq"))).toBe(true));
    expect(connection.status).toBe(Status.BINDING);

    const bind = ws.sent.find((x) => x.includes("<iq"))!;
    const id = /id="([^"]+)"/.exec(bind)?.[1];
    ws.message(
      `<iq xmlns="jabber:client" id="${id}" type="result">
        <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>juliet@capulet.lit/server-res</jid></bind>
      </iq>`,
    );
    await binded;

    expect(connection.status).toBe(Status.BINDED);
    expect(connection.jid.full).toBe("juliet@capulet.lit/server-res");
  });

  it("绑定完成后普通 stanza 转发到 stanza 事件", async () => {
    const { connection, ws } = await connectOpen();
    await authenticate(connection, ws);
    ws.message(BIND_FEATURES);
    await vi.waitFor(() => expect(ws.sent.some((x) => x.includes("<iq"))).toBe(true));
    const id = /id="([^"]+)"/.exec(ws.sent.find((x) => x.includes("<iq"))!)![1];
    ws.message(
      `<iq xmlns="jabber:client" id="${id}" type="result">
        <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>juliet@capulet.lit/res</jid></bind>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.status).toBe(Status.BINDED));

    const received = new Promise<string>((resolve) =>
      connection.once("stanza", (stanza) => resolve(stanza.tagName)),
    );
    ws.message(`<message xmlns="jabber:client" from="romeo@montague.lit/orchard"><body>hi</body></message>`);
    await expect(received).resolves.toBe("message");
  });

  it("服务端关闭 framing 流后忽略 close 后续帧，流事件只发一次", async () => {
    const { connection, ws } = await connectOpen();
    const events: string[] = [];
    connection.on("stream:end", () => events.push("stream:end"));
    connection.on("close", () => events.push("close"));
    connection.on("stanza", () => events.push("stanza"));

    ws.message(`<close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>`);
    await vi.waitFor(() => expect(events).toContain("stream:end"));
    expect(connection.status).toBe(Status.DISCONNECTED);
    expect(events).toEqual(["stream:end", "close"]);
  });

  it("disconnect 发送 framing <close/>、触发 stream:end 并置为断开", async () => {
    const { connection, ws } = await connectOpen();
    const events: string[] = [];
    connection.on("stream:end", () => events.push("stream:end"));
    connection.on("close", () => events.push("close"));

    connection.disconnect();

    expect(ws.sent.at(-1)).toContain('xmlns="urn:ietf:params:xml:ns:xmpp-framing"');
    expect(ws.sent.at(-1)).toContain("<close");
    expect(events).toEqual(["stream:end", "close"]);
    expect(connection.status).toBe(Status.DISCONNECTED);
  });

  it("send 在未连接与非 OPEN 状态下抛错", async () => {
    const connection = new WSConnection(new JID("test@example.com"), "secret");
    await connection.connect("wss://example.com/xmpp");
    expect(() => connection.send("<a/>")).toThrow("websocket not open");

    FakeWebSocket.last().open();
    expect(() => connection.send(`<a xmlns="urn:x"/>`)).not.toThrow();
    expect(FakeWebSocket.last().sent.at(-1)).toBe(`<a xmlns="urn:x"/>`);
  });

  it("onerror 与解析失败的 onmessage 都触发 error 事件", async () => {
    const { connection, ws } = await connectOpen();
    const errors: Error[] = [];
    connection.on("error", (e: Error) => errors.push(e));

    ws.fail();
    ws.message("<a></b>");
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(errors[0].message).toBe("WebSocket error");
    expect(errors[1].message).toContain("Mismatched end tag");
  });

  it("认证 failure 置为 AUTHFAIL 并触发 error 与断开", async () => {
    const { connection, ws } = await connectOpen();
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));

    const errored = new Promise<Error>((resolve) =>
      connection.once("error", (e: Error) => resolve(e)),
    );
    const ended = new Promise<void>((resolve) =>
      connection.once("stream:end", resolve),
    );
    ws.message(AUTH_FEATURES);
    await vi.waitFor(() => expect(ws.sent.some((x) => x.includes("<auth"))).toBe(true));
    ws.message(
      `<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><not-authorized/></failure>`,
    );

    await expect(errored).resolves.toBeInstanceOf(Error);
    await ended;
    expect(connection.status).toBe(Status.DISCONNECTED);
  });
});
