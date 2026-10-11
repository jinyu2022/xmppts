import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0198 from "../../../lib/plugins/xep0198/index";
import type { Connection } from "../../../lib/connection";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import { StanzaBase } from "../../../lib/stanza";
import { Pipeline, SyncPipeline } from "../../../lib/transport/pipeline";
import { Status } from "../../../lib/transport/typing";
import type { TransportPipelineEvents } from "../../../lib/transport/tcp";

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

/** 假传输层：只提供插件用到的管线、流特性与端点字段 */
class FakeTransport extends EventEmitter {
  readonly pipeline = new Pipeline<TransportPipelineEvents>();
  streamFeatures = new Set<string>([XEP0198.NS]);
  host = "localhost";
  port = "5222";
}

/** 假连接：记录报文、保存管线，并模拟 others 事件投递 */
class FakeConnection extends EventEmitter {
  readonly transport = new FakeTransport();
  readonly sent: string[] = [];
  readonly pipeline = new SyncPipeline<{
    send: { stanza: XMPPElement };
    receive: { stanza: XMPPElement };
  }>();

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

/** 完成「binded → <enable/> → <enabled/>」的启用流程 */
function enableSm(
  connection: FakeConnection,
  attrs = `id="sid-1" resume="true"`,
): void {
  connection.transport.emit("binded");
  connection.receive(`<enabled xmlns="urn:xmpp:sm:3" ${attrs}/>`);
}

/** 触发认证后流特性事件，返回管线载荷（outgoing 为连接层预填的绑定请求） */
async function negotiate(connection: FakeConnection) {
  const ctx = { stanza: Parser.parse("<stream:features/>"), outgoing: BIND_REQUEST };
  await connection.transport.pipeline.run("stream:negotiated", ctx);
  return ctx;
}

/** 触发绑定/恢复响应事件，返回管线载荷 */
async function settleBinding(connection: FakeConnection, xml: string) {
  const ctx = {
    stanza: Parser.parse(xml),
    status: Status.BINDING,
    outgoing: undefined as string | undefined,
  };
  await connection.transport.pipeline.run("binding", ctx);
  return ctx;
}

describe("XEP0198（单元测试，假连接）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("资源绑定后向宣告流管理的服务器发送 enable，未宣告时不发送", () => {
    const connection = createPlugin();
    connection.transport.emit("binded");
    expect(connection.count("<enable")).toBe(1);
    expect(connection.sent.join()).toContain('resume="true"');

    const plain = createPlugin(new Set<string>());
    plain.transport.emit("binded");
    expect(plain.sent).toHaveLength(0);
  });

  it("enable 窗口内发送的 stanza 计入发送计数，且不被 <enabled/> 清零", async () => {
    const connection = createPlugin();
    connection.transport.emit("binded");

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

  it("未收到 <enabled/> 时断线，复位后重连绑定会重新发送 enable", () => {
    const connection = createPlugin();
    connection.transport.emit("binded");
    expect(connection.count("<enable")).toBe(1);

    // 未确认的启用请求随本流作废，状态复位后才允许下一次尝试
    connection.emit("connection:lost");
    connection.transport.emit("binded");
    expect(connection.count("<enable")).toBe(2);
  });

  it("启用后记录 id/max/location，断线重连时改发 resume", async () => {
    const connection = createPlugin();
    enableSm(
      connection,
      `id="sid-1" resume="true" max="60" location="alt.example.com:5223"`,
    );

    // location 写回传输层，供重连使用
    expect(connection.transport.host).toBe("alt.example.com");
    expect(connection.transport.port).toBe("5223");

    connection.emit("connection:lost");
    const ctx = await negotiate(connection);
    expect(ctx.outgoing).toContain("<resume");
    expect(ctx.outgoing).toContain("previd='sid-1'");
    expect(ctx.outgoing).toContain("h='0'");
  });

  it("服务器未允许恢复或未经历断线时不改发 resume", async () => {
    // 服务器只回 <enabled/>：不应发 <resume/>
    const refused = createPlugin();
    enableSm(refused, `id="sid-1"`);
    refused.emit("connection:lost");
    expect((await negotiate(refused)).outgoing).toBe(BIND_REQUEST);

    // 服务器允许恢复，但本次是首次连接而非断线重连
    const fresh = createPlugin();
    enableSm(fresh);
    expect((await negotiate(fresh)).outgoing).toBe(BIND_REQUEST);
  });

  it("距断开超过服务器宣告的 max 后放弃恢复", async () => {
    vi.useFakeTimers();
    const connection = createPlugin();
    enableSm(connection, `id="sid-1" resume="true" max="60"`);
    connection.emit("connection:lost");

    vi.advanceTimersByTime(61_000);
    expect((await negotiate(connection)).outgoing).toBe(BIND_REQUEST);
  });

  it("启用后按发送间隔请求确认，并按已处理数量应答服务器的确认请求", async () => {
    const connection = createPlugin();
    enableSm(connection);

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

  it("resumed 沿用原绑定并把连接置为已绑定", async () => {
    const connection = createPlugin();
    enableSm(connection);
    connection.emit("connection:lost");
    await negotiate(connection);

    const ctx = await settleBinding(
      connection,
      '<resumed xmlns="urn:xmpp:sm:3" h="0" previd="sid-1"/>',
    );
    expect(ctx.status).toBe(Status.BINDED);
  });

  it("failed 回退为原始绑定请求并复位恢复状态", async () => {
    const connection = createPlugin();
    enableSm(connection);
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
});
