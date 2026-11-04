import { describe, expect, it } from "vitest";
import { Connection } from "../../../lib/connection";
import XEP0084 from "../../../lib/plugins/xep0084";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";

/**
 * XEP-0084 插件入口测试：确认依赖声明与 PEP 事件链路。
 *
 * @see https://xmpp.org/extensions/xep-0084.html 1.1.5 §3.3 Example 5（头像元数据通知）
 */
describe("XEP0084 插件入口", () => {
  const ID = "111f4b3c50d7b0df729d299bc6f8e9ef9066971f";

  it("仅注册 XEP0084 时依赖被自动加载，能解析 <event> 并派发 pep:avatar", async () => {
    const connection = new Connection("hamlet@denmark.lit/elsinore", "secret");
    // 只注册目标插件，XEP0163 必须由 dependencies 自动补上
    connection.registerPlugin("XEP0084");
    const lifecycle = connection as unknown as {
      instantiatePlugins(): Promise<void>;
      initPlugins(): void;
    };
    await lifecycle.instantiatePlugins();
    lifecycle.initPlugins();

    expect(connection.XEP0084).toBeDefined();
    expect(connection.XEP0163).toBeDefined();

    const received: Message[] = [];
    connection.on("pep:avatar", (message) => {
      expect(message).toBeDefined();
      if (message) received.push(message);
    });
    connection._createSink().onStanza(
      Parser.parse(`<message from="juliet@capulet.lit" to="romeo@montague.lit/home">
        <event xmlns="http://jabber.org/protocol/pubsub#event">
          <items node="${XEP0084.NS.metadata}">
            <item id="${ID}">
              <metadata xmlns="${XEP0084.NS.metadata}">
                <info bytes="12345" height="64" id="${ID}" type="image/png" width="64"/>
              </metadata>
            </item>
          </items>
        </event>
        <addresses xmlns="http://jabber.org/protocol/address">
          <address type="replyto" jid="juliet@capulet.lit/chamber"/>
        </addresses>
      </message>`),
    );

    expect(received).toHaveLength(1);
    expect(received[0].event?.node).toBe(XEP0084.NS.metadata);
    expect(received[0].event?.item).toMatchObject({
      id: ID,
      metadata: { id: ID, type: "image/png", bytes: 12345, width: 64, height: 64 },
    });
  });
});
