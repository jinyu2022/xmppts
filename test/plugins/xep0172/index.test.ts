import { describe, expect, it } from "vitest";
import XEP0172 from "../../../lib/plugins/xep0172";
import { Nickname } from "../../../lib/plugins/xep0172/nickname";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import type { Message } from "../../../lib/stanza";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0172 插件入口测试：确认昵称转换器与 pep:nickname 事件注册、检索与缓存。
 *
 * @see https://xmpp.org/extensions/xep-0172.html 1.1 §3 Format（Example 1）、§4.2 Message Exchange（Example 5）
 */
describe("XEP0172 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0172(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Nickname", () => {
    const plugin = new XEP0172(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Nickname);
  });

  it("仅注册 XEP0172 时依赖被自动加载；直接携带的 <nick/> 不触发 pep:nickname", async () => {
    const connection = new Connection("starbuck@moby-dick.lit", "secret");
    // 只注册目标插件，XEP0163 必须由 dependencies 自动补上
    connection.registerPlugin("XEP0172");
    const lifecycle = connection as unknown as {
      instantiatePlugins(): Promise<void>;
      initPlugins(): void;
    };
    await lifecycle.instantiatePlugins();
    lifecycle.initPlugins();

    expect(connection.XEP0172).toBeDefined();
    expect(connection.XEP0163).toBeDefined();

    const events: Message[] = [];
    connection.on("pep:nickname", (message) => {
      if (message) events.push(message);
    });
    const messages: Message[] = [];
    connection.on("message", (message) => messages.push(message));
    // XEP-0172 §4.2 Example 4：首条消息直接携带 <nick/>，不属于 PEP
    connection._createSink().onStanza(
      Parser.parse(`<message from="narrator@moby-dick.lit/pda" to="starbuck@moby-dick.lit" type="chat">
        <body>Call me Ishmael</body>
        <nick xmlns="${XEP0172.NS}">Ishmael</nick>
      </message>`),
    );

    // pep:nickname 不派发；普通 message 事件仍能读到 parseNickEl 的转换结果
    expect(events).toHaveLength(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].nick).toBe("Ishmael");
    expect(messages[0].body).toBe("Call me Ishmael");
  });

  it("收到 PEP 昵称通知时派发 pep:nickname（§4.2 Example 6）", async () => {
    const connection = new Connection("starbuck@moby-dick.lit", "secret");
    connection.registerPlugin("XEP0172");
    const lifecycle = connection as unknown as {
      instantiatePlugins(): Promise<void>;
      initPlugins(): void;
    };
    await lifecycle.instantiatePlugins();
    lifecycle.initPlugins();

    const received: Message[] = [];
    connection.on("pep:nickname", (message) => {
      if (!message) return;
      // 编译期校验：事件载荷已收窄到昵称节点与必填 nick
      const node: typeof XEP0172.NS = message.event.node;
      const nick: string = message.event.items[0].nick;
      expect(node).toBe(XEP0172.NS);
      expect(nick).toBe("CallMeIshmael");
      received.push(message);
    });
    connection._createSink().onStanza(
      Parser.parse(`<message from="narrator@moby-dick.lit" to="starbuck@moby-dick.lit" type="headline" id="foo">
        <event xmlns="http://jabber.org/protocol/pubsub#event">
          <items node="${XEP0172.NS}">
            <item>
              <nick xmlns="${XEP0172.NS}">CallMeIshmael</nick>
            </item>
          </items>
        </event>
        <addresses xmlns="http://jabber.org/protocol/address">
          <address type="replyto" jid="narrator@moby-dick.lit/pda"/>
        </addresses>
      </message>`),
    );

    expect(received).toHaveLength(1);
    expect(received[0].event?.node).toBe(XEP0172.NS);
    expect(received[0].event?.items?.[0]?.nick).toBe("CallMeIshmael");
  });

  it("init 注册转换器与 pep:nickname 事件", () => {
    const { connection } = setup();

    expect(connection.stanzaPlugins.get(XEP0172.NS)).toBe(XEP0172.parseNickEl);
    expect(connection.matchersOf("pep:nickname")).toHaveLength(1);
    const matcher = connection.matchersOf("pep:nickname")[0];
    // PEP 通知：node 与 item.nick 都匹配
    expect(matcher({ event: { node: XEP0172.NS, items: [{ nick: "Ishmael" }] } })).toBe(true);
    // node 匹配但载荷为空，或 node 不匹配
    expect(matcher({ event: { node: XEP0172.NS, items: [{}] } })).toBe(false);
    expect(matcher({ event: { node: "other" } })).toBe(false);
    // 直接挂在消息上的 nick 不是 PEP 事件
    expect(matcher({ nick: "Ishmael" })).toBe(false);
  });

  it("retrieveNick 返回响应中的昵称，error 时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    // 规范 Example 1：<nick xmlns='http://jabber.org/protocol/nick'>Ishmael</nick>
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result" from="narrator@moby-dick.lit/pda"><nick xmlns="${XEP0172.NS}">Ishmael</nick></iq>`,
    );
    await expect(plugin.retrieveNick("narrator@moby-dick.lit")).resolves.toBe("Ishmael");

    connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
    await expect(plugin.retrieveNick("narrator@moby-dick.lit")).rejects.toBeInstanceOf(
      XMPPError,
    );
  });

  it("getSelfNick 缓存结果且失败时 resolve undefined", async () => {
    const { connection, plugin } = setup();
    let calls = 0;
    connection.sendAsync = () => {
      calls += 1;
      // 规范 Example 5：PEP 节点上的更新昵称
      return Promise.resolve(
        Parser.parse(`<iq type="result"><nick xmlns="${XEP0172.NS}">CallMeIshmael</nick></iq>`),
      );
    };

    await expect(plugin.getSelfNick()).resolves.toBe("CallMeIshmael");
    await expect(plugin.getSelfNick()).resolves.toBe("CallMeIshmael");
    expect(calls).toBe(1);

    connection.sendAsync = () => {
      throw new Error("断线");
    };
    const failing = new XEP0172(new FakeConnection() as unknown as Connection);
    await expect(failing.getSelfNick()).resolves.toBeUndefined();
  });
});
