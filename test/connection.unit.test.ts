import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../lib/connection";
import { JID } from "../lib/JID";
import { XMPPElement } from "../lib/ltx/Element";
import { Parser } from "../lib/ltx/Parser";
import { Iq, Message } from "../lib/stanza";
import { TimeoutError } from "../lib/errors";
import { Pubsub } from "../lib/plugins/xep0060/pubsub";
import XEP0060 from "../lib/plugins/xep0060";
import { XEP0297 } from "../lib/plugins/XEP0297";
import XEP0402 from "../lib/plugins/xep0402";
import { Pipeline } from "../lib/transport/pipeline";
import { Status } from "../lib/transport/typing";
import type { TransportPipelineEvents } from "../lib/transport/tcp";
import type { Options } from "../lib/types";

/**
 * Connection 单元测试：注入假传输层，不建立任何 socket。
 * 覆盖发送校验与拦截、接收路由与插件转换、会话事件时序、自动重连调度、插件依赖解析与卸载。
 * 用例按行为分组，一个 it 内覆盖同组多条断言。
 */

/** 假传输层：只实现 Connection 访问的字段与事件 */
class FakeTransport extends EventEmitter {
  status: number = Status.BINDED;
  host = "localhost";
  port = "5222";
  jid?: JID;
  streamFeatures = new Set<string>();
  pipeline = new Pipeline<TransportPipelineEvents>();
  readonly sent: Array<string | XMPPElement> = [];
  readonly connect = vi.fn(async () => {});
  readonly reconnect = vi.fn(async () => {});
  readonly disconnect = vi.fn();

  send(data: string | XMPPElement): void {
    this.sent.push(data);
  }
}

/** 建立带假传输层的连接，并挂上传输层事件监听 */
function setup(options: Options = {}) {
  const connection = new Connection("test@example.com/resource", "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
    ...options,
  });
  const transport = new FakeTransport();
  connection.transport = transport;
  connection._setupSocketEvents();
  transport.emit("binded");
  return { connection, transport };
}

describe("Connection（单元测试，假传输层）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("send：拒绝缺少必备属性的 stanza，其余自动补全 id/xmlns/xml:lang 并归一化 groupchat 的 to", () => {
    const { connection, transport } = setup();

    expect(() => connection.send("<message><body>hi</body></message>")).toThrow(
      "message stanza缺少to属性",
    );
    expect(() =>
      connection.send("<iq><query xmlns='jabber:iq:register'/></iq>"),
    ).toThrow("iq stanza缺少type属性");

    // 群聊消息：to 归一化为裸 JID（房间 JID 取自 XEP-0045 示例）
    connection.send(
      '<message to="coven@chat.shakespeare.lit/thirdwitch" type="groupchat"><body>hi</body></message>',
    );
    const message = transport.sent[0] as XMPPElement;
    expect(message.getAttribute("to")).toBe("coven@chat.shakespeare.lit");
  });

  it("send：按注册顺序执行发送拦截器，最终元素交给传输层", () => {
    const { connection, transport } = setup();
    connection.pipeline.use("send", (ctx, next) => {
      ctx.stanza.setAttribute("data-step", "1");
      return next();
    });
    connection.pipeline.use("send", (ctx, next) => {
      ctx.stanza.setAttribute("data-step", `${ctx.stanza.getAttribute("data-step")}2`);
      return next();
    });

    connection.send('<message to="a@example.com"><body>x</body></message>');
    expect((transport.sent[0] as XMPPElement).getAttribute("data-step")).toBe("12");
  });

  it("send：流层元素不校验、不注入 id，但仍走发送管线", () => {
    const { connection, transport } = setup();
    const interceptor = vi.fn();
    connection.pipeline.use("send", (ctx, next) => {
      interceptor(ctx.stanza);
      return next();
    });

    connection.send(`<a xmlns='urn:xmpp:sm:3' h='3'/>`);

    expect(interceptor).toHaveBeenCalledTimes(1);
    const ack = transport.sent[0] as XMPPElement;
    expect(ack.namespaceURI).toBe("urn:xmpp:sm:3");
    expect(ack.getAttribute("h")).toBe("3");
    expect(ack.getAttribute("id")).toBeNull();
  });

  it("send：未建立传输层时抛错，不静默丢弃", () => {
    const connection = new Connection("test@example.com/resource", "test123");
    expect(connection.transport).toBeNull();
    expect(() =>
      connection.send('<message to="a@example.com"><body>x</body></message>'),
    ).toThrow();
  });

  it("sendAsync：同 id 响应 resolve，超时与发送失败 reject", async () => {
    vi.useFakeTimers();
    const { connection, transport } = setup();

    const answered = connection.sendAsync(
      Parser.parse('<iq type="get" id="ping-1"><ping xmlns="urn:xmpp:ping"/></iq>'),
    );
    connection.emit("iq", new Iq(Parser.parse('<iq type="result" id="ping-1"/>'), connection));
    await expect(answered).resolves.toBeInstanceOf(XMPPElement);

    const timedOut = connection.sendAsync(
      Parser.parse('<iq type="get" id="ping-2"/>'),
      1000,
    );
    const rejection = expect(timedOut).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;

    transport.send = () => {
      throw new Error("连接已断开");
    };
    await expect(
      connection.sendAsync(Parser.parse('<iq type="get" id="ping-3"/>')),
    ).rejects.toThrow("连接已断开");
    expect(connection.listenerCount("iq")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("send/sendAsync：初始化清空管线期间也拒绝发送，不残留等待资源", async () => {
    vi.useFakeTimers();
    const { connection, transport } = setup();
    transport.status = Status.DISCONNECTED;
    const failures: Array<Promise<void>> = [];
    connection.registerPlugin("InitSender", class {
      constructor(readonly connection: Connection) {}
      init() {
        expect(() => this.connection.send('<iq type="get"/>')).toThrow("连接已断开");
        expect(() => this.connection.send('<r xmlns="urn:xmpp:sm:3"/>')).toThrow("连接已断开");
        failures.push(expect(this.connection.sendAsync(Parser.parse('<iq type="get"/>')))
          .rejects.toThrow("连接已断开"));
      }
    });
    await (connection as unknown as { initPlugins(): Promise<void> }).initPlugins();
    await Promise.all(failures);
    expect(failures).toHaveLength(1);
    expect(transport.sent).toHaveLength(0);
    expect(connection.listenerCount("iq")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("send：协商期间拒绝业务 stanza，流层元素仍可发送；绑定后恢复业务发送", async () => {
    vi.useFakeTimers();
    const { connection, transport } = setup();
    transport.emit("stream:end");
    transport.status = Status.AUTHENTICATED;
    for (const stanza of ['<message to="a@example.com"/>', '<iq type="get"/>', '<presence/>']) {
      expect(() => connection.send(stanza)).toThrow("会话尚未就绪");
    }
    await expect(connection.sendAsync(Parser.parse('<iq type="get"/>')))
      .rejects.toThrow("会话尚未就绪");
    expect(connection.listenerCount("iq")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    connection.send('<enable xmlns="urn:xmpp:sm:3"/>');
    expect(transport.sent).toHaveLength(1);
    transport.status = Status.BINDED;
    transport.emit("binded");
    connection.send('<presence/>');
    expect(transport.sent).toHaveLength(2);
  });

  it("sendAsync：未建立传输层时返回 rejected Promise", async () => {
    vi.useFakeTimers();
    const connection = new Connection("test@example.com/resource", "test123");
    await expect(connection.sendAsync(Parser.parse('<iq type="get"/>')))
      .rejects.toThrow("连接已断开");
    expect(connection.listenerCount("iq")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("接收路由：先过接收拦截器，再按 tagName 分发并执行 stanza 插件转换", () => {
    const { connection, transport } = setup();
    const order: string[] = [];
    connection.pipeline.use("receive", (ctx, next) => {
      order.push(ctx.stanza.tagName);
      return next();
    });
    connection.registerStanzaPlugin("urn:test:caps", () => ({ caps: { node: "n1" } }));

    const messages: Message[] = [];
    const presence: string[] = [];
    const others: string[] = [];
    connection.on("message", (message) => messages.push(message));
    connection.on("presence", (stanza) => presence.push(stanza.tagName));
    connection.on("others", (stanza) => others.push(stanza.tagName));

    transport.emit(
      "stanza",
      Parser.parse(
        '<message from="romeo@montague.lit/orchard" to="juliet@capulet.lit"><x xmlns="urn:test:caps"/></message>',
      ),
    );
    transport.emit("stanza", Parser.parse('<presence from="romeo@montague.lit/orchard"><show>away</show></presence>'));
    transport.emit("stanza", Parser.parse('<r xmlns="urn:xmpp:sm:3"/>'));

    expect(order).toEqual(["message", "presence", "r"]);
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBeInstanceOf(JID);
    // x 元素被 stanza 插件处理成对象挂在实例上
    expect(messages[0].caps).toEqual({ node: "n1" });
    expect(presence).toEqual(["presence"]);
    expect(others).toEqual(["r"]);
  });

  it("接收路由：无转换器的子元素一律不留在实例上", () => {
    const { connection, transport } = setup();
    const messages: Message[] = [];
    connection.on("message", (message) => messages.push(message));

    transport.emit(
      "stanza",
      Parser.parse(
        `<message xmlns="jabber:client" from="romeo@montague.lit/orchard" to="juliet@capulet.lit">
          <x xmlns="vcard-temp:x:update"><photo/></x>
          <thread>t1</thread>
        </message>`,
      ),
    );

    expect(messages).toHaveLength(1);
    // 没有转换器的扩展元素不挂在实例上
    expect(messages[0].x).toBeUndefined();
    // thread 由 Message.parseMessage 解析为字段
    expect(messages[0].thread).toBe("t1");
  });

  it("接收路由：stanza 插件返回值里的同命名空间元素不再二次解析（event 分支与 xep0402 extensions）", () => {
    const { connection, transport } = setup();
    connection.registerStanzaPlugin(Pubsub.NS.EVENT, Pubsub.parseEventEl);
    connection.registerStanzaPlugin(XEP0402.NS, XEP0402.parseConferenceEl);
    connection.registerEventPlugin("bookmark:update", {
      tagName: "message",
      matcher: (message) =>
        message.event?.node === XEP0402.NS && message.event?.item?.conference != null,
    });
    const messages: Message[] = [];
    const updates: Message[] = [];
    connection.on("message", (message) => {
      messages.push(message);
    });
    connection.on("bookmark:update", (message) => {
      updates.push(message);
    });

    // XEP-0060 §8.4.2 Example 160：delete 分支带 <redirect/>，二次解析会丢掉该字段
    transport.emit(
      "stanza",
      Parser.parse(
        `<message from="pubsub.shakespeare.lit" to="juliet@capulet.lit">
          <event xmlns="http://jabber.org/protocol/pubsub#event">
            <delete node="princely_musings">
              <redirect uri="xmpp:hamlet@denmark.lit?;node=blog"/>
            </delete>
          </event>
        </message>`,
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].event?.type).toBe("delete");
    expect(messages[0].event?.redirect).toBe("xmpp:hamlet@denmark.lit?;node=blog");

    // XEP-0402 §3.2 通知：conference 的 <extensions/> 与 conference 同命名空间，
    // 二次解析会命中 parseConferenceEl 的校验收而抛错（真实传输路径上会断开连接）
    const bookmarkMessage = `<message type="headline" from="juliet@capulet.lit" to="juliet@capulet.lit/balcony">
      <event xmlns="http://jabber.org/protocol/pubsub#event">
        <items node="urn:xmpp:bookmarks:1">
          <item id="orchard@conference.shakespeare.lit">
            <conference xmlns="urn:xmpp:bookmarks:1" name="The Orchard" autojoin="1">
              <nick>JC</nick>
              <extensions>
                <state xmlns="http://myclient.example/bookmark/state" minimized="true"/>
              </extensions>
            </conference>
          </item>
        </items>
      </event>
    </message>`;
    expect(() => transport.emit("stanza", Parser.parse(bookmarkMessage))).not.toThrow();
    expect(updates).toHaveLength(1);
    expect(
      updates[0].event?.item?.conference?.extensions?.map((el) => el.localName),
    ).toEqual(["state"]);
  });

  it("type=error 的节：<error/> 转为结构化对象，thread 正常解析", () => {
    const { connection, transport } = setup();
    const messages: Message[] = [];
    const iqs: Iq[] = [];
    connection.on("message", (message) => messages.push(message));
    connection.on("iq", (iq) => iqs.push(iq));

    transport.emit(
      "stanza",
      Parser.parse(
        `<message xmlns="jabber:client" from="pubsub.shakespeare.lit" to="juliet@capulet.lit" type="error">
          <thread>t1</thread>
          <error type="cancel">
            <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
            <text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">节点不存在</text>
            <unsupported xmlns="http://jabber.org/protocol/pubsub#errors" feature="retrieve-items"/>
          </error>
        </message>`,
      ),
    );

    expect(messages[0].type).toBe("error");
    // 条件取 stanza 命名空间，pubsub#errors 的 <unsupported/> 按 tagName 原样保留
    expect(messages[0].error).toMatchObject({
      type: "cancel",
      condition: "item-not-found",
      text: "节点不存在",
    });
    expect(messages[0].error!.unsupported).toBeInstanceOf(XMPPElement);
    // thread 已解析为字段，不受 error 解析影响
    expect(messages[0].thread).toBe("t1");

    transport.emit(
      "stanza",
      Parser.parse(
        `<iq xmlns="jabber:client" from="pubsub.shakespeare.lit" to="juliet@capulet.lit" type="error" id="i1">
          <error type="modify"><bad-request xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
        </iq>`,
      ),
    );
    expect(iqs[0].error).toMatchObject({ type: "modify", condition: "bad-request" });
  });

  it("注册 XEP0060 后：pubsub#errors 附加条件在 <error/> 上解析为对象（§11.1 Example 19）", () => {
    const { connection, transport } = setup();
    const iqs: Iq[] = [];
    connection.on("iq", (iq) => iqs.push(iq));
    new XEP0060(connection).init();

    transport.emit(
      "stanza",
      Parser.parse(
        `<iq xmlns="jabber:client" from="pubsub.shakespeare.lit" type="error" id="i2">
          <error type="cancel">
            <feature-not-implemented xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
            <unsupported xmlns="http://jabber.org/protocol/pubsub#errors" feature="retrieve-subscriptions"/>
          </error>
        </iq>`,
      ),
    );

    expect(iqs[0].error).toMatchObject({
      type: "cancel",
      condition: "feature-not-implemented",
      pubsub: { condition: "unsupported", feature: "retrieve-subscriptions" },
    });
  });

  it("error 解析不影响转发节：forwarded 内的 <message/> 保持原元素", () => {
    const { connection, transport } = setup();
    connection.registerStanzaPlugin(XEP0297.NS, XEP0297.parseForwardedEl);
    const messages: Message[] = [];
    connection.on("message", (message) => messages.push(message));

    transport.emit(
      "stanza",
      Parser.parse(
        `<message from="juliet@capulet.lit" to="romeo@montague.lit">
          <forwarded xmlns="urn:xmpp:forward:0">
            <delay xmlns="urn:xmpp:delay" stamp="2024-01-01T00:00:00Z"/>
            <message xmlns="jabber:client" type="error" from="a@b" to="c@d"/>
          </forwarded>
        </message>`,
      ),
    );

    /** forwarded 的键随内层 stanza 类型变化，取 message 键断言其未被改写 */
    const forwarded = messages[0].forwarded as unknown as Record<string, unknown>;
    expect(forwarded.message).toBeInstanceOf(XMPPElement);
    expect((forwarded.message as XMPPElement).tagName).toBe("message");
  });

  it("会话事件：open→connect、binded→session:start 并采纳服务端 JID、stream:end→session:end、close→disconnect 并清理监听", () => {
    const { connection, transport } = setup();
    const events: string[] = [];
    connection.on("connect", () => events.push("connect"));
    connection.on("session:start", () => events.push("session:start"));
    connection.on("session:end", () => events.push("session:end"));
    connection.on("disconnect", () => events.push("disconnect"));

    transport.emit("open");
    transport.jid = new JID("juliet@capulet.lit/from-server");
    transport.emit("binded");
    expect(connection.jid.toString()).toBe("juliet@capulet.lit/from-server");

    transport.emit("stream:end");
    transport.emit("close");

    expect(events).toEqual(["connect", "session:start", "session:end", "disconnect"]);
    // 真断开后 _cleanup 清空全部监听器
    expect(connection.listenerCount("session:start")).toBe(0);
  });

  it("自动重连：断线只发一次 connection:lost，重连成功后 reconnected 且不再发 session:start", async () => {
    vi.useFakeTimers();
    const { connection, transport } = setup({ reconnect: true, reconnectInterval: 10 });
    const events: string[] = [];
    connection.on("session:start", () => events.push("session:start"));
    connection.on("connection:lost", () => events.push("connection:lost"));
    connection.on("reconnecting", () => events.push("reconnecting"));
    connection.on("reconnected", () => events.push("reconnected"));

    transport.emit("binded");
    transport.status = Status.DISCONNECTED;
    transport.emit("close");
    expect(events).toEqual(["session:start", "connection:lost"]);

    await vi.advanceTimersByTimeAsync(10);
    expect(transport.reconnect).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["session:start", "connection:lost", "reconnecting"]);

    transport.emit("binded");
    expect(events).toEqual([
      "session:start",
      "connection:lost",
      "reconnecting",
      "reconnected",
    ]);
  });

  it("插件：自动递归注册依赖插件，deregisterPlugin 连带卸载依赖它的插件", async () => {
    const { connection } = setup();
    connection.registerPlugin("XEP0280");
    // 直接调用私有初始化，避免 connect() 建立真实 socket
    await (
      connection as unknown as { initPlugins(): Promise<void> }
    ).initPlugins();

    // XEP0280 依赖 XEP0030/XEP0297，XEP0297 又依赖 XEP0203
    for (const name of ["XEP0280", "XEP0297", "XEP0203", "XEP0030"] as const) {
      expect(connection[name], `${name} 未自动注册`).toBeDefined();
    }

    connection.deregisterPlugin("XEP0030");
    // 卸载后的实例是 Proxy，只拦截成员读取（取属性本身不触发）
    expect(() => connection.XEP0030!.init()).toThrow(/unregistered/);
    expect(() => connection.XEP0280!.init()).toThrow(/unregistered/);
    expect(connection.XEP0203).toBeDefined();
  });
});
