import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import MucSelfPing from "../../../lib/plugins/xep0410/MucSelfPing";
import XEP0410 from "../../../lib/plugins/xep0410";
import { XMPPElement } from "../../../lib/ltx/Element";
import { JID } from "../../../lib/JID";
import { TimeoutError, XMPPError } from "../../../lib/errors";
import Ping from "../../../lib/plugins/xep0199/ping";
import type Connection from "../../../lib/connection";

/**
 * XEP-0410: MUC Self-Ping (Schrödinger's Chat)
 * @see https://xmpp.org/extensions/xep-0410.html
 * @version 1.1.0 (2019-09-25)
 *
 * 纯协议部分用例取自 §3.2 Example 1（self-ping IQ）与 Example 2（非成员错误）、
 * §3.3 Example 4（服务端优化 feature）；失活检测逻辑为插件实现细节。
 */
describe("MucSelfPing", () => {
  it("Example 1：createSelfPingIq 生成 GET ping 的 iq", () => {
    const to = "characters@chat.shakespeare.lit/JuliC";
    const iq = MucSelfPing.createSelfPingIq(to);
    const ping = iq.getElementsByTagName("ping")[0];
    expect({
      type: iq.getAttribute("type"),
      to: iq.getAttribute("to"),
      pingNs: ping.namespaceURI,
    }).toEqual({ type: "get", to, pingNs: Ping.NS });
  });

  it("parseSelfPingResponse：result 返回解析后的 iq 对象", () => {
    const iq = XMPPElement.createElement("iq");
    iq.setAttribute("type", "result");
    expect(MucSelfPing.parseSelfPingResponse(iq)).toMatchObject({
      type: "result",
    });
  });

  it.each(["not-acceptable", "item-not-found", "remote-server-not-found"])(
    "parseSelfPingResponse：%s 错误返回 XMPPError",
    (tag) => {
      // §3.2 Example 2 的非成员错误，其余条件取自 §3.2 错误分支说明
      const iq = XMPPElement.createElement("iq");
      iq.setAttribute("type", "error");
      const err = XMPPElement.createElement("error");
      err.appendChild(XMPPElement.createElement(tag));
      iq.appendChild(err);
      expect(MucSelfPing.parseSelfPingResponse(iq)).toBeInstanceOf(XMPPError);
    },
  );

  it("parseSelfPingResponse：非 iq 元素抛错", () => {
    const el = XMPPElement.createElement("message");
    expect(() => MucSelfPing.parseSelfPingResponse(el)).toThrow(
      "expected iq element",
    );
  });

  it("Example 4：hasOptimizationFeature 识别 disco feature", () => {
    const query = XMPPElement.createElement("query");
    const feature = XMPPElement.createElement("feature");
    feature.setAttribute("var", MucSelfPing.NS);
    query.appendChild(feature);
    const empty = XMPPElement.createElement("query");
    expect({
      withFeature: MucSelfPing.hasOptimizationFeature(query),
      withoutFeature: MucSelfPing.hasOptimizationFeature(empty),
    }).toEqual({ withFeature: true, withoutFeature: false });
  });
});

describe("XEP0410 失活检测", () => {
  const roomJid = "characters@chat.shakespeare.lit";
  // 显式传入配置，测试不依赖插件内部默认值
  const config = {
    pingTimeout: 1_000,
    inactivityTimeout: 3_000,
    checkInterval: 1_000,
  };
  const { inactivityTimeout, checkInterval, pingTimeout } = config;
  /** 距最后一次活动多少个扫描节拍才会被判定失活 */
  const ticksToStale = Math.ceil(inactivityTimeout / checkInterval);

  /** 伪造 connection：只需 XEP0045 房间表与 XEP0199 ping 能力 */
  type FakeConnection = EventEmitter & {
    XEP0045: {
      rooms: Map<string, { nick: string; occupants: Map<string, unknown> }>;
      join: Mock;
    };
    XEP0199: { ping: Mock };
    isSessionActive: boolean;
  };

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** 按扫描间隔推进 times 个节拍 */
  const tick = (times = 1) =>
    vi.advanceTimersByTimeAsync(checkInterval * times);

  function createPlugin({
    ping = vi.fn().mockResolvedValue(5),
    join = vi.fn().mockResolvedValue(undefined),
  }: { ping?: Mock; join?: Mock } = {}) {
    const connection = new EventEmitter() as FakeConnection;
    connection.isSessionActive = true;
    connection.XEP0045 = {
      rooms: new Map([[roomJid, { nick: "JuliC", occupants: new Map() }]]),
      join,
    };
    connection.XEP0199 = { ping };

    const plugin = new XEP0410(connection as unknown as Connection, config);
    plugin.init();
    return { connection, ping, join, plugin };
  }

  /** 读取私有活动表，用于断言活动跟踪的范围 */
  const lastActivityOf = (plugin: XEP0410) =>
    (plugin as unknown as { lastActivity: Map<string, number> }).lastActivity;

  it("房间失活达到一个 inactivityTimeout 后才探测", async () => {
    vi.useFakeTimers();
    const { connection, ping } = createPlugin();

    connection.emit("session:start");
    expect(ping).not.toHaveBeenCalled();

    // 房间中途有活动：基线后移，探测整体推迟
    await tick(1);
    connection.emit("muc:groupchat", {
      type: "groupchat",
      from: new JID(`${roomJid}/other-user`),
    });
    await Promise.resolve();

    await tick(ticksToStale - 1);
    expect(ping).not.toHaveBeenCalled();

    await tick(1);
    expect(ping).toHaveBeenCalledOnce();
    expect(ping).toHaveBeenCalledWith(`${roomJid}/JuliC`, pingTimeout);

    // ping 成功会替换基线，需再等一个完整阈值
    await tick(ticksToStale - 1);
    expect(ping).toHaveBeenCalledOnce();

    await tick(1);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("self-ping 成功前后依次发出 muc:stale 与 muc:fresh", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-08-02T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    const { connection } = createPlugin();
    const stale = vi.fn();
    const fresh = vi.fn();
    connection.on("muc:stale", stale);
    connection.on("muc:fresh", fresh);

    connection.emit("session:start");
    await tick(ticksToStale);

    expect(stale).toHaveBeenCalledOnce();
    expect(stale).toHaveBeenCalledWith({ roomJid, staleSince: startedAt });
    expect(fresh).toHaveBeenCalledOnce();
    expect(fresh).toHaveBeenCalledWith({
      roomJid,
      staleSince: startedAt,
      recoveredAt: new Date(startedAt.getTime() + inactivityTimeout),
      rejoined: false,
    });
  });

  it("以 XEP0045 的房间表为准", async () => {
    vi.useFakeTimers();
    const { connection, ping } = createPlugin();

    connection.emit("session:start");
    connection.XEP0045.rooms.delete(roomJid);
    connection.emit("presence", { from: new JID(`${roomJid}/nick`) });
    await Promise.resolve();

    await tick(ticksToStale);
    expect(ping).not.toHaveBeenCalled();
  });

  it("只跟踪已加入房间的活动", () => {
    vi.useFakeTimers();
    const { connection, plugin } = createPlugin();
    const lastActivity = lastActivityOf(plugin);

    connection.emit("session:start");
    // 普通聊天与联系人 presence 的 bare JID 都不是已加入房间
    connection.emit("message", { from: new JID("romeo@montague.lit") });
    connection.emit("presence", { from: new JID("romeo@montague.lit/orchard") });

    expect([...lastActivity.keys()]).toEqual([roomJid]);
  });

  it("会话结束时取消待执行的检测", async () => {
    vi.useFakeTimers();
    const { connection, ping } = createPlugin();

    connection.emit("session:start");
    connection.emit("session:end");
    await tick(ticksToStale);

    expect(ping).not.toHaveBeenCalled();
  });

  it("self-ping 超时后不重入房间", async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockRejectedValue(new TimeoutError("ping timeout"));
    const { connection, join } = createPlugin({ ping });

    connection.emit("session:start");
    await tick(ticksToStale);
    await Promise.resolve();

    expect(ping).toHaveBeenCalledOnce();
    expect(join).not.toHaveBeenCalled();
  });

  it("忽略上一会话遗留的 self-ping 结果", async () => {
    vi.useFakeTimers();
    let rejectPing!: (reason?: unknown) => void;
    const ping = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectPing = reject;
        }),
    );
    const { connection, join } = createPlugin({ ping });

    connection.emit("session:start");
    await tick(ticksToStale);
    expect(ping).toHaveBeenCalledOnce();

    connection.emit("session:end");
    rejectPing(createNotAcceptableError());
    await Promise.resolve();

    expect(join).not.toHaveBeenCalled();
  });

  it("首次重入未完成前不启动第二次重入", async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockRejectedValue(createNotAcceptableError());
    const join = vi.fn(() => new Promise(() => {}));
    const { connection } = createPlugin({ ping, join });

    connection.emit("session:start");
    await tick(ticksToStale);
    await Promise.resolve();
    await tick(ticksToStale);

    expect(join).toHaveBeenCalledOnce();
  });

  function createNotAcceptableError() {
    const iq = XMPPElement.createElement("iq");
    iq.setAttribute("type", "error");
    const error = XMPPElement.createElement("error");
    error.appendChild(XMPPElement.createElement("not-acceptable"));
    iq.appendChild(error);
    return new XMPPError(iq, "not joined");
  }
});
