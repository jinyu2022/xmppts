import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0198 from "../../../lib/plugins/xep0198/index";
import type { Connection } from "../../../lib/connection";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import { StanzaBase } from "../../../lib/stanza";
import { JID } from "../../../lib/JID";
import { Pipeline, SyncPipeline } from "../../../lib/transport/pipeline";
import { Status } from "../../../lib/transport/typing";
import type { TransportPipelineEvents } from "../../../lib/transport/stream-connection";
import logger from "../../../lib/log";

/**
 * XEP-0198: Stream Management（单元测试，假连接 + 假传输层，不建立 socket）
 * @see https://xmpp.org/extensions/xep-0198.html
 * @version 1.6.3 (2025-07-28)
 *
 * 用例取自规范原文：§3 Example 2/3/4（enable/enabled）、§4 Example 7（<r/> → <a/>）、
 * §5 Example 8/9/12/13/14（resume/resumed/failed）、§8.2 Example 26（每 5 条请求确认）。
 * 用例按行为分组，一个 it 内覆盖同组多条断言。
 */

/** 认证后服务器宣告资源绑定的流特性对应的绑定请求（连接层预填的 outgoing） */
const BIND_REQUEST =
  "<iq type='set' id='bind-1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>resource</resource></bind></iq>";

/** 资源绑定成功响应（测试只需其出现，不校验内容） */
const BIND_RESULT =
  "<iq type='result' id='bind-1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>juliet@capulet.lit/resource</jid></bind></iq>";

/** 假传输层：只提供插件用到的管线、流特性、端点字段与直发通道 */
class FakeTransport extends EventEmitter {
  readonly pipeline = new Pipeline<TransportPipelineEvents>();
  /** 绕过连接层管线、直接写出的报文（插件重发未确认项、发送流错误时使用） */
  readonly sent: string[] = [];
  streamFeatures = new Set<string>([XEP0198.NS]);
  host = "localhost";
  port = "5222";

  send(data: string | XMPPElement): void {
    this.sent.push(typeof data === "string" ? data : data.toXMLString());
  }
}

/** 假连接：记录报文、保存管线，并模拟 others 事件投递 */
class FakeConnection extends EventEmitter {
  /** from 缺失的 stanza 会回退到该 JID 的 bare（RFC 6120 §8.1.2.1） */
  readonly jid = new JID("juliet@capulet.lit/resource");
  readonly transport = new FakeTransport();
  readonly sent: string[] = [];
  /** 主动断开调用次数（发送流错误后应关闭流） */
  disconnected = 0;
  readonly pipeline = new SyncPipeline<{
    send: { stanza: XMPPElement };
    receive: { stanza: XMPPElement };
  }>();

  /** 模拟 Connection.disconnect：先同步派发 beforeclose，再计数 */
  disconnect(): void {
    this.emit("session:beforeclose");
    this.disconnected++;
  }

  /** 模拟 Connection.send：先过发送管线，再记录最终报文 */
  send(stanza: string | XMPPElement): void {
    const parsed = typeof stanza === "string" ? Parser.parse(stanza) : stanza;
    const current = this.pipeline.run("send", { stanza: parsed }).stanza;
    this.sent.push(current.toXMLString());
  }

  /** 模拟服务端发来 stanza：先过接收管线，再投递到 others 事件 */
  receive(xml: string): void {
    const stanza = this.pipeline.run("receive", { stanza: Parser.parse(xml) }).stanza;
    this.emit("others", new StanzaBase(stanza, this as unknown as Connection));
  }

  /** 已发送报文里包含指定片段的条数 */
  count(fragment: string): number {
    return this.sent.filter((xml) => xml.includes(fragment)).length;
  }
}

/** 创建插件并初始化（注册管线与传输层事件） */
function createPlugin(streamFeatures = new Set([XEP0198.NS])) {
  const connection = new FakeConnection();
  connection.transport.streamFeatures = streamFeatures;
  const plugin = new XEP0198(connection as unknown as Connection);
  plugin.init();
  return connection;
}

/** 完成「绑定成功 → session:start → <enable/> → <enabled/>」的启用流程 */
async function enableSm(
  connection: FakeConnection,
  attrs = `id="sid-1" resume="true"`,
): Promise<void> {
  await finishBind(connection);
  connection.receive(`<enabled xmlns="urn:xmpp:sm:3" ${attrs}/>`);
}

/** 触发认证后流特性事件，返回管线载荷（outgoing 为连接层预填的绑定请求） */
async function negotiate(connection: FakeConnection) {
  const ctx = { stanza: Parser.parse("<stream:features/>"), outgoing: BIND_REQUEST };
  await connection.transport.pipeline.run("stream:negotiated", ctx);
  return ctx;
}

/**
 * 触发绑定/恢复响应事件，返回管线载荷
 * @param status 传给管线的连接状态；模拟传输层已完成绑定即传 BINDED
 */
async function settleBinding(
  connection: FakeConnection,
  xml: string,
  status: (typeof Status)[keyof typeof Status] = Status.BINDING,
) {
  const ctx = {
    stanza: Parser.parse(xml),
    status,
    outgoing: undefined as string | undefined,
  };
  await connection.transport.pipeline.run("binding", ctx);
  return ctx;
}

/** 模拟绑定成功并触发会话就绪事件（插件在 session:start 之后发送 <enable/>） */
async function finishBind(connection: FakeConnection): Promise<void> {
  await settleBinding(connection, BIND_RESULT, Status.BINDED);
  connection.emit("session:start");
}

describe("XEP0198（单元测试，假连接）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("资源绑定后向宣告流管理的服务器发送 enable，未宣告时不发送", async () => {
    const connection = createPlugin();
    await finishBind(connection);
    expect(connection.count("<enable")).toBe(1);
    expect(connection.sent.join()).toContain('resume="true"');

    const plain = createPlugin(new Set<string>());
    await finishBind(plain);
    expect(plain.sent).toHaveLength(0);
  });

  it("enable 窗口内发送的 stanza 计入发送计数，且不被 <enabled/> 清零", async () => {
    const connection = createPlugin();
    await finishBind(connection);

    // 窗口内（已写出 <enable/>、未收到 <enabled/>）发送 4 条：只累计计数，不请求确认
    for (let i = 0; i < 4; i++) {
      connection.send(`<message to="romeo@montague.lit/orchard"><body>${i}</body></message>`);
    }
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(0);

    // <enabled/> 后再发 1 条即达到间隔：计数自 <enable/> 写出起算，窗口内的 4 条未被清零
    connection.receive(`<enabled xmlns="urn:xmpp:sm:3" id="sid-1" resume="true"/>`);
    connection.send('<message to="romeo@montague.lit/orchard"><body>last</body></message>');
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(1);
  });

  it("未收到 <enabled/> 时断线，复位后重连绑定会重新发送 enable", async () => {
    const connection = createPlugin();
    await finishBind(connection);
    expect(connection.count("<enable")).toBe(1);

    // 未确认的启用请求随本流作废，状态复位后才允许下一次尝试
    connection.emit("connection:lost");
    await finishBind(connection);
    expect(connection.count("<enable")).toBe(2);
  });

  it("未收到 <enabled/> 时断线，启用失败经 onSessionReady 的 catch 记 error", async () => {
    const error = vi
      .spyOn(logger.getLogger("XEP0198"), "error")
      .mockImplementation(() => {});
    const connection = createPlugin();
    await finishBind(connection);
    expect(connection.count("<enable")).toBe(1);

    // 未确认的 <enable/> 以失败收尾，而不是留下永不 settle 的 Promise
    connection.emit("connection:lost");
    // enable() 是 async 函数，reject 要多经过一层微任务才到达 catch
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalledWith(
      "启用流管理失败",
      expect.objectContaining({ message: "连接中断，流管理启用未确认" }),
    );
  });

  it("启用后记录 id/max/location，断线重连时改发 resume", async () => {
    const connection = createPlugin();
    await enableSm(
      connection,
      `id="sid-1" resume="true" max="60" location="alt.example.com:5223"`,
    );

    // location 只用于「下一次连接」：启用期间不改写端点，断线时才生效
    expect(connection.transport.host).toBe("localhost");
    expect(connection.transport.port).toBe("5222");

    connection.emit("connection:lost");
    expect(connection.transport.host).toBe("alt.example.com");
    expect(connection.transport.port).toBe("5223");

    const ctx = await negotiate(connection);
    expect(ctx.outgoing).toContain("<resume");
    expect(ctx.outgoing).toContain("previd='sid-1'");
    expect(ctx.outgoing).toContain("h='0'");
  });

  it("previd 中的 XML 特殊字符按属性转义后发送", async () => {
    const connection = createPlugin();
    // 服务端生成的 SM-ID 可以含任意合法属性字符（XEP-0198 §5），解析后 id 为 a'b&c
    await enableSm(connection, `id="a&apos;b&amp;c" resume="true"`);
    connection.emit("connection:lost");

    const ctx = await negotiate(connection);
    expect(ctx.outgoing).toContain("previd='a&apos;b&amp;c'");
  });

  it("服务器未允许恢复或未经历断线时不改发 resume", async () => {
    // 服务器只回 <enabled/>：不应发 <resume/>
    const refused = createPlugin();
    await enableSm(refused, `id="sid-1"`);
    refused.emit("connection:lost");
    expect((await negotiate(refused)).outgoing).toBe(BIND_REQUEST);

    // 服务器允许恢复，但本次是首次连接而非断线重连
    const fresh = createPlugin();
    await enableSm(fresh);
    expect((await negotiate(fresh)).outgoing).toBe(BIND_REQUEST);
  });

  it("服务器不允许恢复时，断线重连的新流会重新发送 enable 并重置计数", async () => {
    const connection = createPlugin();
    // 服务器只回 <enabled/>（无 resume）：断线后无法恢复，旧流状态必须作废
    await enableSm(connection, `id="sid-1"`);
    expect(connection.count("<enable")).toBe(1);

    // 旧流已处理 2 条
    connection.receive('<message from="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.receive('<message from="romeo@montague.lit/orchard"><body>b</body></message>');

    connection.emit("connection:lost");
    // 不尝试恢复，走常规绑定
    expect((await negotiate(connection)).outgoing).toBe(BIND_REQUEST);
    connection.emit("reconnected");
    expect(connection.count("<enable")).toBe(2);

    // 新流自 <enabled/> 起重新计数，不沿用旧流的已处理数量
    connection.receive(`<enabled xmlns="urn:xmpp:sm:3"/>`);
    connection.receive('<r xmlns="urn:xmpp:sm:3"/>');
    expect(connection.sent.at(-1)).toContain('h="0"');
  });

  it("距断开超过服务器宣告的 max 后放弃恢复", async () => {
    vi.useFakeTimers();
    const connection = createPlugin();
    await enableSm(connection, `id="sid-1" resume="true" max="60"`);
    connection.emit("connection:lost");

    vi.advanceTimersByTime(61_000);
    expect((await negotiate(connection)).outgoing).toBe(BIND_REQUEST);
  });

  it("服务器给出的 max 不是正整数时保留默认恢复窗口", async () => {
    const connection = new FakeConnection();
    const plugin = new XEP0198(connection as unknown as Connection);
    plugin.init();
    await enableSm(connection, `id="sid-1" resume="true" max="soon"`);

    expect((plugin as unknown as { max: number }).max).toBe(5 * 60 * 1000);
  });

  it("流管理启用前不响应服务器的确认请求", async () => {
    const connection = createPlugin();
    await finishBind(connection);

    // 已发送 <enable/>、未收到 <enabled/>：此时不应回答 <r/>
    connection.receive('<r xmlns="urn:xmpp:sm:3"/>');
    expect(connection.count("<a ")).toBe(0);
  });

  it("启用后按发送间隔请求确认，并按已处理数量应答服务器的确认请求", async () => {
    const connection = createPlugin();
    await enableSm(connection);

    // 未到间隔：不发 <r/>
    for (let i = 0; i < 4; i++) {
      connection.send(`<message to="romeo@montague.lit/orchard"><body>${i}</body></message>`);
    }
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(0);

    // 第 5 条触发 <r/>，收到 <a/> 后结算
    connection.send('<message to="romeo@montague.lit/orchard"><body>4</body></message>');
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(1);
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="5"/>');

    // 再发 4 条不请求，第 5 条再次请求
    for (let i = 0; i < 4; i++) {
      connection.send(`<message to="romeo@montague.lit/orchard"><body>${i}</body></message>`);
    }
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(1);
    connection.send('<message to="romeo@montague.lit/orchard"><body>last</body></message>');
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(2);
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="10"/>');

    // 服务器的确认请求按已处理数量应答
    connection.receive('<message from="romeo@montague.lit/orchard"><body>hi</body></message>');
    connection.receive('<message from="romeo@montague.lit/orchard"><body>hi2</body></message>');
    connection.receive('<r xmlns="urn:xmpp:sm:3"/>');
    expect(connection.sent.at(-1)).toContain("<a ");
    expect(connection.sent.at(-1)).toContain('h="2"');
  });

  it("同一批连发达到间隔时只请求一次确认", async () => {
    const connection = createPlugin();
    await enableSm(connection);

    // 同一宏任务内连发 5 条：请求确认按发送条数递减，不应每个 stanza 各发一次 <r/>
    for (let i = 0; i < 5; i++) {
      connection.send(`<message to="romeo@montague.lit/orchard"><body>${i}</body></message>`);
    }
    await Promise.resolve();
    expect(connection.count("<r xmlns")).toBe(1);
  });

  it("确认按累积游标前进，重复与迟到的 h 不会回退", async () => {
    const connection = new FakeConnection();
    const plugin = new XEP0198(connection as unknown as Connection);
    plugin.init();
    await enableSm(connection);
    const state = plugin as unknown as { lastAck: number; unacked: unknown[] };

    for (let i = 0; i < 5; i++) {
      connection.send(`<message to="romeo@montague.lit/orchard"><body>${i}</body></message>`);
    }
    await Promise.resolve();

    // 部分确认：只裁掉 h 之前的项
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="2"/>');
    expect(state.lastAck).toBe(2);
    expect(state.unacked).toHaveLength(3);

    // 重复与迟到的确认都不改变游标
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="2"/>');
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="1"/>');
    expect(state.lastAck).toBe(2);
    expect(state.unacked).toHaveLength(3);

    // 后续确认正常前进并清空队列
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="5"/>');
    expect(state.lastAck).toBe(5);
    expect(state.unacked).toHaveLength(0);
  });

  it("resumed 沿用原绑定并把连接置为已绑定", async () => {
    const connection = createPlugin();
    await enableSm(connection);
    connection.emit("connection:lost");
    await negotiate(connection);

    const ctx = await settleBinding(
      connection,
      '<resumed xmlns="urn:xmpp:sm:3" h="0" previd="sid-1"/>',
    );
    expect(ctx.status).toBe(Status.BINDED);
  });

  it("resumed 的 previd 与请求不一致时回退为常规绑定，并报告未确认条数", async () => {
    const warn = vi.spyOn(logger.getLogger("XEP0198"), "warn").mockImplementation(() => {});
    const connection = createPlugin();
    await enableSm(connection);
    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.emit("connection:lost");
    await negotiate(connection);

    const ctx = await settleBinding(
      connection,
      '<resumed xmlns="urn:xmpp:sm:3" h="0" previd="other"/>',
    );
    expect(ctx.outgoing).toBe(BIND_REQUEST);
    expect(ctx.status).toBe(Status.BINDING);
    // 未确认项不会在新流重发，与 <failed/> 一致地报告条数
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 条未确认"));
    // 复位后不再改发 resume
    expect((await negotiate(connection)).outgoing).toBe(BIND_REQUEST);
  });

  it("failed 回退为原始绑定请求并复位恢复状态", async () => {
    const connection = createPlugin();
    await enableSm(connection);
    connection.emit("connection:lost");
    await negotiate(connection);

    const failed = await settleBinding(
      connection,
      `<failed xmlns="urn:xmpp:sm:3"><item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></failed>`,
    );
    expect(failed.outgoing).toBe(BIND_REQUEST);

    // 复位后不再改发 resume
    expect((await negotiate(connection)).outgoing).toBe(BIND_REQUEST);
  });

  it("resumed 按 h 结算后重发剩余未确认项，且不重复计数", async () => {
    const connection = new FakeConnection();
    const plugin = new XEP0198(connection as unknown as Connection);
    plugin.init();
    await enableSm(connection);
    const state = plugin as unknown as { outbound: number; unacked: unknown[] };

    // 断线前发出两条未获确认的消息
    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.send('<message to="romeo@montague.lit/orchard"><body>b</body></message>');
    expect(state.unacked).toHaveLength(2);

    connection.emit("connection:lost");
    await negotiate(connection);
    await settleBinding(
      connection,
      '<resumed xmlns="urn:xmpp:sm:3" h="1" previd="sid-1"/>',
    );

    // 服务器已处理第一条：只重发第二条，且沿用原序号、不重新计数
    expect(connection.transport.sent).toHaveLength(1);
    expect(connection.transport.sent[0]).toContain("<body>b</body>");
    expect(state.outbound).toBe(2);
    expect(state.unacked).toHaveLength(1);
  });

  it("确认数量超过已发送数量时按 §6 发送流错误并关闭流", async () => {
    const connection = createPlugin();
    await enableSm(connection);

    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    // 只发出 1 条，服务器却确认了 2 条
    connection.receive('<a xmlns="urn:xmpp:sm:3" h="2"/>');

    const error = connection.transport.sent.at(-1)!;
    expect(error).toContain("<stream:error");
    expect(error).toContain("undefined-condition");
    expect(error).toContain("<handled-count-too-high");
    expect(error).toContain("h='2'");
    expect(error).toContain("send-count='1'");
    expect(connection.disconnected).toBe(1);
    // 流错误已终止流：关闭前的 beforeclose 不应再补发 <a/>
    expect(connection.count("<a ")).toBe(0);
  });

  it("resumed 的 h 超过已发送数量时按 §6 关流，不当作恢复成功", async () => {
    const connection = createPlugin();
    await enableSm(connection);
    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.emit("connection:lost");
    await negotiate(connection);

    const ctx = await settleBinding(
      connection,
      '<resumed xmlns="urn:xmpp:sm:3" h="2" previd="sid-1"/>',
    );

    expect(ctx.status).toBe(Status.BINDING);
    expect(connection.transport.sent.at(-1)).toContain("<handled-count-too-high");
    expect(connection.transport.sent).toHaveLength(1);
    expect(connection.disconnected).toBe(1);
  });

  it("failed 的 h 超过已发送数量时按 §6 关流，不回退绑定", async () => {
    const connection = createPlugin();
    await enableSm(connection);
    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.emit("connection:lost");
    await negotiate(connection);

    const failed = await settleBinding(
      connection,
      `<failed xmlns="urn:xmpp:sm:3" h="9"><item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></failed>`,
    );

    expect(failed.outgoing).toBeUndefined();
    expect(connection.transport.sent.at(-1)).toContain("<handled-count-too-high");
    expect(connection.disconnected).toBe(1);
  });

  it("failed 带 h 时按已处理数量结算，剩余项不重发", async () => {
    const warn = vi.spyOn(logger.getLogger("XEP0198"), "warn").mockImplementation(() => {});
    const connection = createPlugin();
    await enableSm(connection);

    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.send('<message to="romeo@montague.lit/orchard"><body>b</body></message>');

    connection.emit("connection:lost");
    await negotiate(connection);
    // 超时前服务器已收到第一条（XEP-0198 §5 Example 14），旧流终结后不再重发
    const failed = await settleBinding(
      connection,
      `<failed xmlns="urn:xmpp:sm:3" h="1"><item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></failed>`,
    );

    expect(failed.outgoing).toBe(BIND_REQUEST);
    expect(connection.transport.sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 条未确认"));
  });

  it("主动关闭流前同步发出 <a/>，h 为已处理数量", async () => {
    const connection = createPlugin();
    await enableSm(connection);
    connection.receive('<message from="romeo@montague.lit/orchard"><body>a</body></message>');
    connection.receive('<message from="romeo@montague.lit/orchard"><body>b</body></message>');

    // 派发时尚未关流：记录监听器读到的断开计数
    const observed: number[] = [];
    connection.on("session:beforeclose", () => observed.push(connection.disconnected));
    connection.disconnect();

    // emit 同步完成：返回时 <a/> 已写出，随后才关流
    expect(observed).toEqual([0]);
    expect(connection.sent.at(-1)).toContain('<a xmlns="urn:xmpp:sm:3"');
    expect(connection.sent.at(-1)).toContain('h="2"');
    expect(connection.disconnected).toBe(1);
  });

  it("流管理未启用时主动断开不发送 <a/>", () => {
    const connection = createPlugin();

    connection.disconnect();

    expect(connection.count("<a ")).toBe(0);
    expect(connection.disconnected).toBe(1);
  });

  it("发送与接收计数按 uint32 回绕", async () => {
    // 直接操纵计数，避免真的发送 42 亿条 stanza
    const connection = new FakeConnection();
    const plugin = new XEP0198(connection as unknown as Connection);
    plugin.init();
    await enableSm(connection);
    const counters = plugin as unknown as { outbound: number; inbound: number };

    // 2^32-1 之前正常递增，再加一回到 0（XEP-0198 §4）
    counters.outbound = 0xffff_fffe;
    connection.send('<message to="romeo@montague.lit/orchard"><body>a</body></message>');
    expect(counters.outbound).toBe(0xffff_ffff);
    connection.send('<message to="romeo@montague.lit/orchard"><body>b</body></message>');
    expect(counters.outbound).toBe(0);

    counters.inbound = 0xffff_ffff;
    connection.receive('<message from="romeo@montague.lit/orchard"><body>c</body></message>');
    expect(counters.inbound).toBe(0);
  });
});
