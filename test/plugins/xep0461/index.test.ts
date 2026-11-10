import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { Message } from "../../../lib/stanza";
import type { Connection } from "../../../lib/connection";
import XEP0461 from "../../../lib/plugins/xep0461";
import { Reply } from "../../../lib/plugins/xep0461/reply";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0461 插件入口测试：确认转换器与回复发送。
 *
 * @see https://xmpp.org/extensions/xep-0461.html 0.2.1 §3
 */
describe("XEP0461 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0461(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  function parseMessage(connection: FakeConnection, xml: string) {
    return new Message(
      Parser.parse(xml),
      connection as unknown as Connection,
    );
  }

  it("继承 Reply 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0461(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Reply);
    expect(XEP0461.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Reply.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Reply.NS)).toBe(Reply.parseReplyEl);
    expect(connection.matchersOf("message:reply")).toHaveLength(0);
  });

  it("reply 自动推断 1:1 回复的收件人与引用", () => {
    const { connection, plugin } = setup();
    // §3 Example 1 被回复的消息
    const original = parseMessage(
      connection,
      `<message from="anna@example.com/tablet" id="message-id1" type="chat">
         <body>We should bake a cake</body>
       </message>`,
    );

    // §3 Example 2
    plugin.reply(original, "Great idea!");

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.getAttribute("to")).toBe("anna@example.com/tablet");
    expect(sent.getAttribute("type")).toBe("chat");
    expect(sent.getElementsByTagName("body")[0].textContent).toBe("Great idea!");

    const reply = sent.getElementsByTagName("reply")[0];
    expect(reply.getAttribute("to")).toBe("anna@example.com/tablet");
    expect(reply.getAttribute("id")).toBe("message-id1");
  });

  it("reply 对群聊消息发送到房间 bare JID 并引用 stanza-id", () => {
    const { connection, plugin } = setup();
    const original = parseMessage(
      connection,
      `<message from="coven@chat.shakespeare.lit/firstwitch" type="groupchat" id="client-id">
         <body>Thrice the brinded cat hath mew'd.</body>
         <stanza-id xmlns="urn:xmpp:sid:0" by="coven@chat.shakespeare.lit" id="39K7ZYIp"/>
       </message>`,
    );

    plugin.reply(original, "A reply");

    const sent = connection.sent[0];
    expect(sent.getAttribute("to")).toBe("coven@chat.shakespeare.lit");
    expect(sent.getAttribute("type")).toBe("groupchat");
    const reply = sent.getElementsByTagName("reply")[0];
    expect(reply.getAttribute("to")).toBe(
      "coven@chat.shakespeare.lit/firstwitch",
    );
    expect(reply.getAttribute("id")).toBe("39K7ZYIp");
  });

  it("reply 开启 quote 时加入引用块与 fallback", () => {
    const { connection, plugin } = setup();
    const original = parseMessage(
      connection,
      `<message from="anna@example.com/tablet" id="message-id1" type="chat">
         <body>We should bake a cake</body>
       </message>`,
    );

    plugin.reply(original, "Great idea!", true);

    const sent = connection.sent[0];
    expect(sent.getElementsByTagName("body")[0].textContent).toBe(
      "> We should bake a cake\nGreat idea!",
    );
    expect(sent.getElementsByTagName("fallback")).toHaveLength(1);
    expect(sent.getElementsByTagName("reply")[0].getAttribute("id")).toBe(
      "message-id1",
    );
  });

  it("sendReply 显式指定引用目标", () => {
    const { connection, plugin } = setup();

    plugin.sendReply(
      "anna@example.com",
      "anna@example.com/tablet",
      "message-id1",
      "Hi",
      "chat",
    );

    const sent = connection.sent[0];
    expect(sent.getAttribute("to")).toBe("anna@example.com");
    expect(sent.getElementsByTagName("reply")[0].getAttribute("id")).toBe(
      "message-id1",
    );
  });
});
