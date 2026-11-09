import { describe, expect, it } from "vitest";
import XEP0333 from "../../../lib/plugins/xep0333";
import { Markers } from "../../../lib/plugins/xep0333/markers";
import XEP0030 from "../../../lib/plugins/xep0030";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";
import { Status, type TransportSocket } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0333 插件入口测试：确认转换器与已读标记发送。
 *
 * @see https://xmpp.org/extensions/xep-0333.html 1.0.0 §3、§4
 */
describe("XEP0333 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0333(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Markers 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0333(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Markers);
    expect(XEP0333.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Markers.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Markers.NS)).toBe(
      Markers.parseMarkerEl,
    );
    expect(connection.matchersOf("message:markable")).toHaveLength(0);
    expect(connection.matchersOf("message:displayed")).toHaveLength(0);
  });

  it("sendDisplayed 发送只含 displayed 的消息", () => {
    const { connection, plugin } = setup();

    // §4.2 示例的 displayed 结构，类型由调用方指定
    plugin.sendDisplayed("romeo@montague.lit", "the-msg-1", "chat");

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.tagName).toBe("message");
    expect(sent.getAttribute("to")).toBe("romeo@montague.lit");
    expect(sent.getElementsByTagName("displayed")[0].getAttribute("id")).toBe(
      "the-msg-1",
    );
  });

  it("sendDisplayed 支持群聊标记", () => {
    const { connection, plugin } = setup();

    // §4.3 群聊标记
    plugin.sendDisplayed(
      "coven@chat.shakespeare.lit",
      "39K7ZYIp",
      "groupchat",
    );

    const sent = connection.sent[0];
    expect(sent.getAttribute("type")).toBe("groupchat");
    expect(sent.getElementsByTagName("displayed")[0].getAttribute("id")).toBe(
      "39K7ZYIp",
    );
  });

  it("接收 §4.1、§4.2 示例的消息，解析出 markable 与 displayed", () => {
    const connection = new Connection("romeo@montague.lit/orchard", "secret");
    // XEP0333 依赖 XEP0030 宣告特性，先挂上依赖实例（插件属性由 as const 表推导为只读）
    Object.assign(connection, { XEP0030: new XEP0030(connection) });
    const sink = connection._createSink();
    // 接收路径只访问 transport.status，onBinded 另需 transport.jid
    connection.transport = {
      status: Status.BINDED,
      jid: connection.jid,
    } as unknown as TransportSocket;
    sink.onBinded();
    new XEP0333(connection).init();

    const received: Message[] = [];
    connection.on("message", (message) => {
      received.push(message);
    });

    // §4.1 示例：发送方请求已读标记
    sink.onStanza(
      Parser.parse(
        `<message to="juliet@capulet.lit" from="romeo@montague.lit/orchard" id="the-msg-1">
           <body>Hi. How are you?</body>
           <markable xmlns="urn:xmpp:chat-markers:0"/>
           <request xmlns="urn:xmpp:receipts"/>
         </message>`,
      ),
    );
    // §4.2 示例：接收方回应已显示
    sink.onStanza(
      Parser.parse(
        `<message to="romeo@montague.lit" from="juliet@capulet.lit/balcony" id="message-2">
           <displayed xmlns="urn:xmpp:chat-markers:0" id="the-msg-1"/>
         </message>`,
      ),
    );

    expect(received).toHaveLength(2);
    expect(received[0].markable).toBe(true);
    expect(received[1].displayed).toEqual({ id: "the-msg-1" });
  });
});
