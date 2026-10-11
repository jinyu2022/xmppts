import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0199 from "../../../lib/plugins/xep0199";
import Ping from "../../../lib/plugins/xep0199/ping";
import type { Connection } from "../../../lib/connection";
import { Iq } from "../../../lib/stanza";
import { Parser } from "../../../lib/ltx/Parser";
import { Status } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0199 插件入口测试：确认 ping 应答、配置合并与 keepalive 定时。
 *
 * @see https://xmpp.org/extensions/xep-0199.html 2.0.1 §4.1 Server-To-Client Pings（Example 1、Example 2）
 */
describe("XEP0199 插件入口", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup(options?: ConstructorParameters<typeof XEP0199>[1]) {
    const connection = new FakeConnection();
    const plugin = new XEP0199(connection as unknown as Connection, options);
    plugin.init();
    return { connection, plugin };
  }

  function makeIq(connection: FakeConnection, xml: string) {
    return new Iq(Parser.parse(xml), connection as unknown as Connection);
  }

  it("声明 XEP0030 依赖，init 宣告特性并注册 iq 处理器", () => {
    const { connection } = setup();

    expect(XEP0199.dependencies).toEqual(["XEP0030"]);
    expect(connection.features.has(Ping.NS)).toBe(true);
    expect(connection.listenerCount("iq")).toBe(1);
  });

  it("收到 ping get 时回复 result", () => {
    const { connection } = setup();

    // 规范 Example 1：服务器 ping 客户端
    connection.emit(
      "iq",
      makeIq(
        connection,
        `<iq from="capulet.lit" to="juliet@capulet.lit/balcony" id="s2c1" type="get"><ping xmlns="${Ping.NS}"/></iq>`,
      ),
    );

    expect(connection.sent).toHaveLength(1);
    expect(connection.sent[0].getAttribute("type")).toBe("result");
    expect(connection.sent[0].getAttribute("id")).toBe("s2c1");
    expect(connection.sent[0].getAttribute("to")).toBe("capulet.lit");
  });

  it("非 ping 的 iq 不响应", () => {
    const { connection } = setup();

    connection.emit(
      "iq",
      makeIq(
        connection,
        `<iq from="capulet.lit" to="juliet@capulet.lit/balcony" id="s2c2" type="get"><query xmlns="http://jabber.org/protocol/disco#info"/></iq>`,
      ),
    );

    expect(connection.sent).toHaveLength(0);
  });

  it("interval 短于 timeout 时回退默认配置，正常配置直接合并", () => {
    type Config = { keepalive: boolean; interval: number; timeout: number };
    const readConfig = (plugin: XEP0199) =>
      (plugin as unknown as { config: Config }).config;

    const fallback = setup({ interval: 1000, timeout: 5000 });
    expect(readConfig(fallback.plugin).interval).toBe(300_000);
    expect(readConfig(fallback.plugin).timeout).toBe(30_000);

    const merged = setup({ keepalive: false, interval: 60_000, timeout: 10_000 });
    expect(readConfig(merged.plugin)).toEqual({
      keepalive: false,
      interval: 60_000,
      timeout: 10_000,
    });
  });

  it("会话建立且服务器宣告 ping 特性后自动启动 keepalive", async () => {
    vi.useFakeTimers();
    const { connection, plugin } = setup({ interval: 60_000 });

    // 会话未开始时即使特性已宣告也不启动
    connection.serverFeatures.add(Ping.NS);
    await vi.advanceTimersByTimeAsync(0);
    expect((plugin as unknown as { timer?: unknown }).timer).toBeUndefined();

    connection.emit("session:start");
    await vi.advanceTimersByTimeAsync(0);
    expect((plugin as unknown as { timer?: unknown }).timer).toBeDefined();
  });

  it("keepalive 按 interval 发送 ping 且尊重 keepalive=false", async () => {
    vi.useFakeTimers();
    const { connection, plugin } = setup({ interval: 60_000, timeout: 10_000 });
    const sendAsync = vi.spyOn(connection, "sendAsync");
    const pingSpy = vi.spyOn(plugin, "ping");
    // 连接处于活跃状态，避免 keepalive 因断开而早退
    connection.transport = { status: Status.BINDED };

    plugin.keepAlivePing();
    expect((plugin as unknown as { timer?: unknown }).timer).toBeDefined();

    // 未到 interval 不 ping
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pingSpy).not.toHaveBeenCalled();

    // 到点后 ping 自身域
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pingSpy).toHaveBeenCalledTimes(1);
    const [pingIq] = sendAsync.mock.calls[0];
    expect(pingIq.getAttribute("to")).toBe("capulet.lit");
    expect(pingIq.getElementsByTagNameNS(Ping.NS, "ping")).toHaveLength(1);

    // 连接断开时早退
    connection.transport = { status: Status.DISCONNECTED };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pingSpy).toHaveBeenCalledTimes(1);

    // keepalive=false 时不 ping
    const disabled = setup({ keepalive: false });
    disabled.connection.transport = { status: Status.BINDED };
    disabled.plugin.keepAlivePing();
    const disabledSend = vi.spyOn(disabled.connection, "sendAsync");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(disabledSend).not.toHaveBeenCalled();
  });

  it("会话建立后服务器不支持时不启动 keepalive", async () => {
    vi.useFakeTimers();
    const { connection, plugin } = setup({ interval: 60_000 });

    connection.emit("session:start");
    await vi.advanceTimersByTimeAsync(0);
    expect((plugin as unknown as { timer?: unknown }).timer).toBeUndefined();
    expect(vi.spyOn(connection, "sendAsync")).not.toHaveBeenCalled();
  });
});
