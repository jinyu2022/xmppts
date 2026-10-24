import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../lib/client";
import { Connection } from "../lib/connection";
import { pluginLoaders } from "../lib/plugins";
import { Status, type TransportSink, type TransportSocket } from "../lib/transport/typing";
import { Pipeline } from "../lib/transport/pipeline";
import type { TransportPipelineEvents } from "../lib/transport/stream-connection";
import { XMPPElement } from "../lib/ltx/Element";
import { Parser } from "../lib/ltx/Parser";
import { JID } from "../lib/JID";

/**
 * Client 便捷方法单元测试：注入假传输层与假插件实例，不建立 socket。
 * 覆盖默认插件注册、消息发送/异步发送的超时语义、名册委托与 presence 发送。
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6121 §2 Roster、§4 Presence（示例 JID 取自 XEP 常用系列）
 */

/** 示例 JID：沿用 capulet/montague 系命名 */
const SELF = "juliet@capulet.lit/balcony";
const PEER = "romeo@montague.lit/orchard";

/** 假传输层：只实现 Connection 访问的字段与通知接收者 */
class FakeTransport {
  status: TransportSocket["status"] = Status.BINDED;
  jid: JID = new JID(SELF);
  host = "localhost";
  port = "5222";
  streamFeatures = new Set<string>();
  pipeline = new Pipeline<TransportPipelineEvents>();
  readonly sent: Array<string | XMPPElement> = [];

  constructor(readonly sink: TransportSink) {}

  send(data: string | XMPPElement): void {
    this.sent.push(data);
  }

  connect = vi.fn(async () => {});
  disconnect = vi.fn();
  reconnect = vi.fn(async () => {});
}

function setup(sessionActive = true) {
  const client = new Client(SELF, "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
  });
  const transport = new FakeTransport(client._createSink());
  client.transport = transport;
  if (sessionActive) {
    transport.sink.onBinded();
  } else {
    transport.status = Status.DISCONNECTED;
  }
  return { client, transport };
}

describe("Client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registerDefaultPlugins 登记 pluginLoaders 的全部插件并实例化", async () => {
    const { client, transport } = setup(false);
    client.transport = transport;

    client.registerDefaultPlugins();
    // 私有成员：运行时按名字直接访问，与 Connection 的插件挂载方式一致
    const lifecycle = client as unknown as {
      instantiatePlugins(): Promise<void>;
      initPlugins(): void;
    };
    await lifecycle.instantiatePlugins();
    lifecycle.initPlugins();

    for (const name of Object.keys(pluginLoaders) as Array<
      keyof typeof pluginLoaders
    >) {
      expect(client[name]).toBeDefined();
      expect(typeof (client[name] as { init: unknown }).init).toBe("function");
    }
  });

  it("sendMsg 按参数构造 message 并交给传输层", () => {
    const { client, transport } = setup();

    client.sendMsg(PEER, "hi", "chat");

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0] as XMPPElement;
    expect(sent.tagName).toBe("message");
    expect(sent.getAttribute("to")).toBe(PEER);
    expect(sent.getAttribute("type")).toBe("chat");
    expect(sent.getElementsByTagName("body")[0].textContent).toBe("hi");
  });

  it("postMsg 收到同 id 响应时返回响应元素", async () => {
    const { client, transport } = setup();

    const pending = client.postMsg(PEER, "hi");
    const request = transport.sent[0] as XMPPElement;
    transport.sink.onStanza(
      Parser.parse(
        `<message xmlns="jabber:client" id="${request.getAttribute("id")}" from="${PEER}" to="${SELF}"/>`,
      ),
    );

    await expect(pending).resolves.toBeInstanceOf(XMPPElement);
  });

  it("postMsg 超时视为成功（resolve undefined）", async () => {
    vi.useFakeTimers();
    const { client } = setup();

    const pending = client.postMsg(PEER, "hi");
    const assertion = expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("postMsg 在非超时错误时向上抛出", async () => {
    const { client, transport } = setup();
    transport.send = () => {
      throw new Error("连接已断开");
    };

    await expect(client.postMsg(PEER, "hi")).rejects.toThrow("连接已断开");
  });

  it("名册方法委托给 RFC6121 插件", () => {
    const { client } = setup();
    const roster = {
      getRoster: vi.fn(() => "roster"),
      setRoster: vi.fn(() => "set"),
      removeRoster: vi.fn(() => "remove"),
    };
    // 插件字段由 Connection 的映射类型声明为只读，运行时可直接赋值
    Object.assign(client, { RFC6121: roster });

    expect(client.getRoster()).toBe("roster");
    expect(client.setRoster(PEER, "朋友", "组")).toBe("set");
    expect(client.removeRoster(PEER)).toBe("remove");
    expect(roster.setRoster).toHaveBeenCalledWith(PEER, "朋友", "组");
    expect(roster.removeRoster).toHaveBeenCalledWith(PEER);
  });

  it("setPresence 发出带 show=chat 的 presence", () => {
    const { client, transport } = setup();

    client.setPresence();

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0] as XMPPElement;
    expect(sent.tagName).toBe("presence");
    expect(sent.getElementsByTagName("show")[0].textContent).toBe("chat");
  });

  it("Client 继承 Connection 并保留构造参数", () => {
    const { client } = setup();
    expect(client).toBeInstanceOf(Connection);
    expect(client.jid.full).toBe(SELF);
  });
});
