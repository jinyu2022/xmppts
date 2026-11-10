import { describe, expect, it } from "vitest";
import { Connection } from "../../../lib/connection";
import XEP0084 from "../../../lib/plugins/xep0084";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";
import { XMPPError } from "../../../lib/errors";
import { FakeConnection } from "../../helpers/fake-connection";

/** 单个 IQ 结果的 sendAsync 替身：按调用顺序依次返回 */
function queueResults(connection: FakeConnection, results: string[]) {
  const queue = results.map((xml) => Parser.parse(xml));
  connection.sendAsync = (stanza) => {
    connection.sentAsync.push(stanza);
    return Promise.resolve(queue.shift()!);
  };
}

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
    expect(received[0].event?.items?.[0]).toMatchObject({
      id: ID,
      metadata: { id: ID, type: "image/png", bytes: 12345, width: 64, height: 64 },
    });
  });
});

describe("XEP0084 数据获取与发布", () => {
  const ID = "111f4b3c50d7b0df729d299bc6f8e9ef9066971f";
  const META_RESULT = `<iq type="result">
    <pubsub xmlns="http://jabber.org/protocol/pubsub">
      <items node="${XEP0084.NS.metadata}">
        <item id="${ID}">
          <metadata xmlns="${XEP0084.NS.metadata}">
            <info bytes="12345" height="64" id="${ID}" type="image/png" width="64"/>
          </metadata>
        </item>
      </items>
    </pubsub>
  </iq>`;
  const DATA_RESULT = `<iq type="result">
    <pubsub xmlns="http://jabber.org/protocol/pubsub">
      <items node="${XEP0084.NS.data}">
        <item id="${ID}">
          <data xmlns="${XEP0084.NS.data}">BASE64</data>
        </item>
      </items>
    </pubsub>
  </iq>`;

  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0084(connection as unknown as Connection);
    return { connection, plugin };
  }

  it("getAvatarData：无 metadata 时先查元数据，再按 ItemID 取数据", async () => {
    const { connection, plugin } = setup();
    queueResults(connection, [META_RESULT, DATA_RESULT]);

    const avatar = await plugin.getAvatarData("juliet@capulet.lit");

    expect(avatar).toMatchObject({
      id: ID,
      type: "image/png",
      bytes: 12345,
      width: 64,
      height: 64,
      data: "BASE64",
    });
    expect(connection.sentAsync).toHaveLength(2);
    expect(
      connection.sentAsync[1].getElementsByTagName("item")[0].getAttribute("id"),
    ).toBe(ID);
  });

  it("getAvatarData：无 metadata 元素返回 undefined，空 metadata 返回 null", async () => {
    const { connection, plugin } = setup();

    queueResults(connection, [
      `<iq type="result"><pubsub xmlns="http://jabber.org/protocol/pubsub"><items node="${XEP0084.NS.metadata}"/></pubsub></iq>`,
    ]);
    await expect(plugin.getAvatarData("juliet@capulet.lit")).resolves.toBeUndefined();

    queueResults(connection, [
      `<iq type="result"><pubsub xmlns="http://jabber.org/protocol/pubsub"><items node="${XEP0084.NS.metadata}"><item id="x"><metadata xmlns="${XEP0084.NS.metadata}"/></item></items></pubsub></iq>`,
    ]);
    await expect(plugin.getAvatarData("juliet@capulet.lit")).resolves.toBeNull();
  });

  it("getAvatarData：元数据与数据请求失败分别抛 XMPPError", async () => {
    const { connection, plugin } = setup();

    queueResults(connection, [`<iq type="error"/>`]);
    await expect(plugin.getAvatarData("juliet@capulet.lit")).rejects.toBeInstanceOf(
      XMPPError,
    );

    queueResults(connection, [META_RESULT, `<iq type="error"/>`]);
    await expect(plugin.getAvatarData("juliet@capulet.lit")).rejects.toBeInstanceOf(
      XMPPError,
    );
  });

  it("getAvatarData：传入 metadata 时只请求数据，缺 data 元素时为 undefined", async () => {
    const { connection, plugin } = setup();
    queueResults(connection, [
      `<iq type="result"><pubsub xmlns="http://jabber.org/protocol/pubsub"><items node="${XEP0084.NS.data}"/></pubsub></iq>`,
    ]);

    const avatar = await plugin.getAvatarData("juliet@capulet.lit", {
      id: ID,
      type: "image/png",
      bytes: 12345,
    });

    expect(connection.sentAsync).toHaveLength(1);
    expect(avatar).toMatchObject({ id: ID, data: undefined });
  });

  it("publishAvatarData：连续发布数据与元数据，任一失败抛 XMPPError", async () => {
    const { fileURLToPath } = await import("node:url");
    const filePath = fileURLToPath(new URL("./xmpp.png", import.meta.url));

    const { connection, plugin } = setup();
    queueResults(connection, [`<iq type="result"/>`, `<iq type="result"/>`]);
    await expect(plugin.publishAvatarData(filePath)).resolves.toBeUndefined();
    expect(connection.sentAsync).toHaveLength(2);

    queueResults(connection, [`<iq type="error"/>`]);
    await expect(plugin.publishAvatarData(filePath)).rejects.toBeInstanceOf(
      XMPPError,
    );

    queueResults(connection, [`<iq type="result"/>`, `<iq type="error"/>`]);
    await expect(plugin.publishAvatarData(filePath)).rejects.toBeInstanceOf(
      XMPPError,
    );
  });
});
