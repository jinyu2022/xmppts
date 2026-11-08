import { describe, expect, it } from "vitest";
import XEP0334 from "../../../lib/plugins/xep0334";
import { Hints } from "../../../lib/plugins/xep0334/hints";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";
import { Status, type TransportSocket } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0334 插件入口测试：转换器注册与接收链路。
 *
 * @see https://xmpp.org/extensions/xep-0334.html 1.0.0 §3
 */
describe("XEP0334 插件入口", () => {
  it("init 只注册转换器，不宣告特性", () => {
    const connection = new FakeConnection();
    const plugin = new XEP0334(connection as unknown as Connection);
    plugin.init();

    expect(connection.stanzaPlugins.get(Hints.NS)).toBe(Hints.parseHintEl);
    expect(connection.features.size).toBe(0);
  });

  it("接收 §3 Example 1 的消息，提示合并为数组", () => {
    const connection = new Connection("juliet@capulet.lit/laptop", "secret");
    const sink = connection._createSink();
    // 接收路径只访问 transport.status，onBinded 另需 transport.jid
    connection.transport = {
      status: Status.BINDED,
      jid: connection.jid,
    } as unknown as TransportSocket;
    sink.onBinded();
    new XEP0334(connection).init();

    const received: Message[] = [];
    connection.on("message", (message) => {
      received.push(message);
    });

    // §3 Example 1：no-copy 与 no-store 同时出现
    sink.onStanza(
      Parser.parse(
        `<message from="romeo@montague.lit/laptop" to="juliet@capulet.lit/laptop">
           <body>V unir avtug'f pybnx gb uvqr zr sebz gurve fvtug</body>
           <no-copy xmlns="urn:xmpp:hints"/>
           <no-store xmlns="urn:xmpp:hints"/>
         </message>`,
      ),
    );

    expect(received).toHaveLength(1);
    expect(received[0].hints).toEqual(["no-copy", "no-store"]);
  });
});
