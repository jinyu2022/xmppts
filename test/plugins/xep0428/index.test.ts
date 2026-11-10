import { describe, expect, it } from "vitest";
import XEP0428 from "../../../lib/plugins/xep0428";
import { Fallback } from "../../../lib/plugins/xep0428/fallback";
import XEP0030 from "../../../lib/plugins/xep0030";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";
import { Status, type TransportSocket } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0428 插件入口测试：特性与转换器注册、接收链路。
 *
 * @see https://xmpp.org/extensions/xep-0428.html 0.2.1 §2
 */
describe("XEP0428 插件入口", () => {
  it("init 宣告特性并注册转换器", () => {
    const connection = new FakeConnection();
    const plugin = new XEP0428(connection as unknown as Connection);
    plugin.init();

    expect(connection.features.has(Fallback.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Fallback.NS)).toBe(
      Fallback.parseFallbackEl,
    );
  });

  it("接收 §2 示例的消息，fallbacks 合并为数组", () => {
    const connection = new Connection("juliet@capulet.lit/laptop", "secret");
    // XEP0428 依赖 XEP0030 宣告特性，先挂上依赖实例（插件属性由 as const 表推导为只读）
    Object.assign(connection, { XEP0030: new XEP0030(connection) });
    const sink = connection._createSink();
    // 接收路径只访问 transport.status，onBinded 另需 transport.jid
    connection.transport = {
      status: Status.BINDED,
      jid: connection.jid,
    } as unknown as TransportSocket;
    sink.onBinded();
    new XEP0428(connection).init();

    const received: Message[] = [];
    connection.on("message", (message) => {
      received.push(message);
    });

    // §2 Fallback Indicator 示例
    sink.onStanza(
      Parser.parse(
        `<message to="anna@example.com" id="message-id2" type="groupchat">
           <body>
             > Anna wrote:
             > Hi, how are you?
             Great
           </body>
           <reply to="anna@example.com" id="message-id1" xmlns="urn:xmpp:reply:0"/>
           <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0">
             <body start="0" end="33"/>
           </fallback>
         </message>`,
      ),
    );

    expect(received).toHaveLength(1);
    expect(received[0].fallbacks).toEqual([
      { for: "urn:xmpp:reply:0", body: [{ start: 0, end: 33 }] },
    ]);
  });
});
