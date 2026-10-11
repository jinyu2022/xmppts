import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import {
  getServer,
  serverRef,
  waitForReceived,
  type MockServer,
} from "../../helpers/mock-transport";

// 将 node:net / node:tls 替换为 Mock Socket，避免真实 TCP/TLS 连接
vi.mock("node:net", async () => {
  const { netMock } = await import("../../helpers/mock-transport");
  return netMock();
});
// TLSSocket 需保留真实导出（传输层用 instanceof 判断 TLS 就绪）
vi.mock("node:tls", async (importOriginal) => {
  const { tlsMock } = await import("../../helpers/mock-transport");
  return tlsMock(importOriginal);
});

/** 只宣告 PLAIN 认证机制的流特性 */
const AUTH_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
    <mechanism>PLAIN</mechanism>
  </mechanisms>
</stream:features>`;

/** 认证后宣告资源绑定的流特性 */
const BIND_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>
</stream:features>`;

const SASL_SUCCESS = `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`;

/** §3.2 Example 5：检索结果，autojoin 的 "true"/"1" 两种写法各一个 */
const RETRIEVE_BOOKMARKS = `
  <pubsub xmlns="http://jabber.org/protocol/pubsub">
    <items node="urn:xmpp:bookmarks:1">
      <item id="theplay@conference.shakespeare.lit">
        <conference xmlns="urn:xmpp:bookmarks:1"
                    name="The Play&apos;s the Thing"
                    autojoin="true">
          <nick>JC</nick>
        </conference>
      </item>
      <item id="orchard@conference.shakespeare.lit">
        <conference xmlns="urn:xmpp:bookmarks:1"
                    name="The Orcard"
                    autojoin="1">
          <nick>JC</nick>
        </conference>
      </item>
    </items>
  </pubsub>`;

/** §3.2 Example 5 的第二项：通知用例的起始状态 */
const RETRIEVE_ORCHARD = `
  <pubsub xmlns="http://jabber.org/protocol/pubsub">
    <items node="urn:xmpp:bookmarks:1">
      <item id="orchard@conference.shakespeare.lit">
        <conference xmlns="urn:xmpp:bookmarks:1"
                    name="The Orcard"
                    autojoin="1">
          <nick>JC</nick>
        </conference>
      </item>
    </items>
  </pubsub>`;

/** §4 Example 12：新增书签的通知载荷 */
const EXAMPLE_12_ITEMS = `<items node="urn:xmpp:bookmarks:1">
  <item id="theplay@conference.shakespeare.lit">
    <conference xmlns="urn:xmpp:bookmarks:1"
                name="The Play&apos;s the Thing"
                autojoin="1">
      <nick>JC</nick>
    </conference>
  </item>
</items>`;

/** §3.4 Example 8：编辑书签的通知载荷（改名并转为自动加入） */
const EXAMPLE_8_ITEMS = `<items node="urn:xmpp:bookmarks:1">
  <item id="orchard@conference.shakespeare.lit">
    <conference xmlns="urn:xmpp:bookmarks:1" name="The Orchard" autojoin="true">
      <nick>JC</nick>
      <extensions>
        <state xmlns="http://myclient.example/bookmark/state" minimized="true"/>
      </extensions>
    </conference>
  </item>
</items>`;

/** §4 Example 13：autojoin 缺省（即 false）的通知载荷 */
const EXAMPLE_13_ITEMS = `<items node="urn:xmpp:bookmarks:1">
  <item id="theplay@conference.shakespeare.lit">
    <conference xmlns="urn:xmpp:bookmarks:1">
      <nick>JC</nick>
    </conference>
  </item>
</items>`;

/** 已建立连接的引用，供 afterEach 统一断开 */
const active = new Set<Connection>();

/** 创建注册了 XEP0402 的连接（未注册 XEP0045，自动加入逻辑应跳过） */
function createConnection(): Connection {
  const connection = new Connection("juliet@capulet.lit/balcony", "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
  });
  active.add(connection);
  connection.registerPlugin("XEP0402");
  return connection;
}

/** 推进一次流协商：流头 → PLAIN 认证 → 流重启 → 送出绑定特性 */
async function negotiate(server: MockServer) {
  server.acceptConnection();
  await waitForReceived(server, "<stream:stream");
  server.send(AUTH_FEATURES);
  await waitForReceived(server, "<auth");
  server.send(SASL_SUCCESS);
  await waitForReceived(server, "<stream:stream");
  server.send(BIND_FEATURES);
}

/** 应答资源绑定请求 */
async function answerBind(server: MockServer) {
  const bind = Parser.parse(await waitForReceived(server, "<iq"));
  server.send(`<iq xmlns="jabber:client" id="${bind.getAttribute("id")}" type="result">
    <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">
      <jid>juliet@capulet.lit/balcony</jid>
    </bind>
  </iq>`);
}

/**
 * 完成「连接 → 认证 → 绑定 → 首次书签检索」并应答检索结果
 * @param itemsXml 检索结果中 `<items/>` 的内容
 */
async function connectAndAnswerRetrieve(itemsXml: string) {
  const connection = createConnection();
  const sessionStart = new Promise<void>((resolve) =>
    connection.once("session:start", () => resolve()),
  );
  await connection.connect();
  const server = getServer();
  await negotiate(server);
  await answerBind(server);
  await sessionStart;

  // 插件在 session:start 时检索书签
  const retrieveIq = Parser.parse(
    await waitForReceived(server, "urn:xmpp:bookmarks:1"),
  );
  server.send(
    `<iq xmlns="jabber:client" type="result" id="${retrieveIq.getAttribute("id")}">${itemsXml}</iq>`,
  );
  await vi.waitFor(() =>
    expect(connection.XEP0402!.bookmarks.length).toBeGreaterThan(0),
  );
  return { connection, server };
}

/** 发送一条书签通知（§4 Example 12/13/14 结构），默认来自本账号 */
function sendNotification(
  server: MockServer,
  eventXml: string,
  from = "juliet@capulet.lit",
) {
  server.send(`<message xmlns="jabber:client" from="${from}"
    to="juliet@capulet.lit/balcony" type="headline">
    <event xmlns="http://jabber.org/protocol/pubsub#event">${eventXml}</event>
  </message>`);
}

/**
 * XEP-0402 插件入口集成测试：Mock Socket 驱动「连接 → 认证 → 绑定」，
 * 验证会话建立后装载公开书签状态，以及其他客户端对书签的增删改经 PEP 通知同步到本地状态。
 *
 * @see https://xmpp.org/extensions/xep-0402.html 1.2.0 §3.2 Example 5（检索）、§4 Example 12/13/14（通知）
 */
describe("XEP0402 插件入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverRef.current = null;
  });

  afterEach(() => {
    for (const connection of active) {
      connection.transport?.disconnect();
    }
    active.clear();
  });

  it("会话建立后检索并装载书签，未加载 XEP0045 时同样生效", async () => {
    const { connection } = await connectAndAnswerRetrieve(RETRIEVE_BOOKMARKS);

    // Example 5：两个书签，autojoin 的 "true"/"1" 两种写法均为真
    expect(connection.XEP0402!.bookmarks.map((b) => b.jid)).toEqual([
      "theplay@conference.shakespeare.lit",
      "orchard@conference.shakespeare.lit",
    ]);
    expect(connection.XEP0402!.bookmarks.map((b) => b.autojoin)).toEqual([
      true,
      true,
    ]);
    expect(connection.XEP0402!.bookmarks[0].name).toBe("The Play's the Thing");
    expect(connection.XEP0402!.bookmarks[0].nick).toBe("JC");
  });

  it("bookmark:update 通知新增书签并按 item id 更新已有书签", async () => {
    const { connection, server } = await connectAndAnswerRetrieve(RETRIEVE_ORCHARD);

    // §4 Example 12：其他客户端新增书签
    sendNotification(server, EXAMPLE_12_ITEMS);
    await vi.waitFor(() => expect(connection.XEP0402!.bookmarks).toHaveLength(2));
    expect(connection.XEP0402!.bookmarks[1].jid).toBe(
      "theplay@conference.shakespeare.lit",
    );
    expect(connection.XEP0402!.bookmarks[1].autojoin).toBe(true);

    // §3.4 Example 8：同 item id 重新发布，改名并转为自动加入
    sendNotification(server, EXAMPLE_8_ITEMS);
    await vi.waitFor(() =>
      expect(connection.XEP0402!.bookmarks[0].name).toBe("The Orchard"),
    );
    expect(connection.XEP0402!.bookmarks).toHaveLength(2);
    expect(connection.XEP0402!.bookmarks[0].autojoin).toBe(true);
  });

  it("bookmark:delete 通知按 item id 移除书签", async () => {
    const { connection, server } = await connectAndAnswerRetrieve(RETRIEVE_BOOKMARKS);

    // §4 Example 14：撤回通知
    sendNotification(
      server,
      `<items node="urn:xmpp:bookmarks:1">
        <retract id="theplay@conference.shakespeare.lit"/>
      </items>`,
    );

    await vi.waitFor(() => expect(connection.XEP0402!.bookmarks).toHaveLength(1));
    expect(connection.XEP0402!.bookmarks[0].jid).toBe(
      "orchard@conference.shakespeare.lit",
    );
  });

  it("联系人同名节点的通知不更新本地书签", async () => {
    const { connection, server } = await connectAndAnswerRetrieve(RETRIEVE_BOOKMARKS);
    const updates: unknown[] = [];
    connection.on("bookmark:update", (message) => updates.push(message));

    // §4 Example 13：同样的 theplay 节点，但发布者是联系人
    sendNotification(server, EXAMPLE_13_ITEMS, "romeo@montague.lit");
    // 同步屏障：本账号的改名通知，处理完它即可确认前一条已被丢弃
    sendNotification(server, EXAMPLE_8_ITEMS);
    await vi.waitFor(() =>
      expect(connection.XEP0402!.bookmarks[1].name).toBe("The Orchard"),
    );

    expect(updates).toHaveLength(1);
    expect(connection.XEP0402!.bookmarks.map((b) => b.autojoin)).toEqual([
      true,
      true,
    ]);
  });
});

