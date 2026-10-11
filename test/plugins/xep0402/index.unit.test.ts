import { describe, expect, it, vi } from "vitest";
import XEP0402 from "../../../lib/plugins/xep0402";
import { Bookmarks } from "../../../lib/plugins/xep0402/bookmarks";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0402 插件入口单元测试：注入假连接，验证特性宣告、转换器与事件注册、IQ 处理与自动加入。
 *
 * @see https://xmpp.org/extensions/xep-0402.html 1.2.0 §3.2 Retrieving all bookmarks（Example 5）
 */
describe("XEP0402 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0402(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Bookmarks、声明依赖并宣告 notify 特性", () => {
    const { connection } = setup();
    expect(new XEP0402(new FakeConnection() as unknown as Connection)).toBeInstanceOf(Bookmarks);
    expect(XEP0402.dependencies).toEqual(["XEP0030", "XEP0163", "XEP0060"]);
    expect(connection.features.has(XEP0402.NS_NOTIFY)).toBe(true);
  });

  it("init 注册转换器与 bookmark:update/delete 事件", () => {
    const { connection } = setup();

    expect(connection.stanzaPlugins.get(XEP0402.NS)).toBe(XEP0402.parseConferenceEl);
    /** 本账号的 PEP 通知（XEP-0163 §4.3.1：from 为发布者 bare JID） */
    const ownMessage = (event: unknown) => ({ from: { bare: "juliet@capulet.lit" }, event });
    expect(
      connection.matchersOf("bookmark:update")[0](
        ownMessage({ node: Bookmarks.NS, item: { conference: {} } }),
      ),
    ).toBe(true);
    expect(
      connection.matchersOf("bookmark:delete")[0](
        ownMessage({ node: Bookmarks.NS, retracts: {} }),
      ),
    ).toBe(true);
    expect(connection.matchersOf("bookmark:update")[0](ownMessage({ node: "other" }))).toBe(
      false,
    );
    // 联系人自己发布的同名节点事件是合法 PEP，但不是本账号书签
    expect(
      connection.matchersOf("bookmark:update")[0]({
        from: { bare: "romeo@montague.lit" },
        event: { node: Bookmarks.NS, item: { conference: {} } },
      }),
    ).toBe(false);
  });

  it("retrieveBookmarks 解析服务端返回的书签", async () => {
    const { connection, plugin } = setup();
    // 规范 Example 5：item id 即房间 JID，conference 里没有 jid 属性
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result" to="juliet@capulet.lit/balcony" id="retrieve1">
        <pubsub xmlns="http://jabber.org/protocol/pubsub">
          <items node="urn:xmpp:bookmarks:1">
            <item id="theplay@conference.shakespeare.lit">
              <conference xmlns="urn:xmpp:bookmarks:1"
                          name="The Play&apos;s the Thing"
                          autojoin="true">
                <nick>JC</nick>
              </conference>
            </item>
          </items>
        </pubsub>
      </iq>`,
    );

    const conferences = await plugin.retrieveBookmarks();
    expect(conferences).toHaveLength(1);
    expect(conferences[0].jid).toBe("theplay@conference.shakespeare.lit");
    expect(conferences[0].autojoin).toBe(true);
  });

  it("retrieveBookmarks 在 error 响应时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    connection.sendAsyncResult = Parser.parse(
      `<iq type="error"><error type="cancel"><item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`,
    );

    await expect(plugin.retrieveBookmarks()).rejects.toBeInstanceOf(XMPPError);
  });

  it("addBookmark 携带 publish-options，密码照常写入 conference", async () => {
    const { connection, plugin } = setup();
    await plugin.addBookmark({
      jid: "theplay@conference.shakespeare.lit",
      autojoin: true,
      password: "example-password",
    });

    const [iq] = connection.sentAsync;
    const options = iq.getElementsByTagName("publish-options")[0];
    const formType = Array.from(options.getElementsByTagName("field")).find(
      (field) => field.getAttribute("var") === "FORM_TYPE",
    )!;
    expect(formType.getElementsByTagName("value")[0].textContent).toBe(
      "http://jabber.org/protocol/pubsub#publish-options",
    );
    expect(
      iq.getElementsByTagName("conference")[0].getElementsByTagName("password")[0]
        .textContent,
    ).toBe("example-password");
  });

  it("editBookmark 同样携带 publish-options", async () => {
    const { connection, plugin } = setup();
    await plugin.editBookmark({ jid: "theplay@conference.shakespeare.lit", name: "改名" });

    expect(connection.sentAsync[0].getElementsByTagName("publish-options")).toHaveLength(1);
  });

  it("configureBookmarkNode 提交 owner 节点配置表单", async () => {
    const { connection, plugin } = setup();
    await plugin.configureBookmarkNode();

    const [iq] = connection.sentAsync;
    expect(iq.getAttribute("type")).toBe("set");
    expect(iq.getAttribute("to")).toBe("juliet@capulet.lit");
    const configure = iq.getElementsByTagName("configure")[0];
    expect(configure.getAttribute("node")).toBe(Bookmarks.NS);
    expect(configure.getElementsByTagName("x")[0].getAttribute("type")).toBe("submit");
  });

  it("configureBookmarkNode 在 error 响应时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    connection.sendAsyncResult = Parser.parse(
      `<iq type="error"><error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`,
    );

    await expect(plugin.configureBookmarkNode()).rejects.toBeInstanceOf(XMPPError);
  });

  it("自动加入房间时把书签密码传给 MUC.join", async () => {
    const { connection } = setup();
    /** MUC.join 收到的参数 */
    const joins: Array<[string, string, unknown]> = [];
    (connection as unknown as { XEP0045?: unknown }).XEP0045 = {
      join: (room: string, nick: string, options?: unknown) => {
        joins.push([room, nick, options]);
        return Promise.resolve();
      },
    };
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result">
        <pubsub xmlns="http://jabber.org/protocol/pubsub">
          <items node="urn:xmpp:bookmarks:1">
            <item id="theplay@conference.shakespeare.lit">
              <conference xmlns="urn:xmpp:bookmarks:1" autojoin="true">
                <nick>JC</nick><password>example-password</password>
              </conference>
            </item>
          </items>
        </pubsub>
      </iq>`,
    );

    connection.emit("session:start");

    await vi.waitFor(() => expect(joins).toHaveLength(1));
    expect(joins[0]).toEqual([
      "theplay@conference.shakespeare.lit",
      "JC",
      { password: "example-password" },
    ]);
  });

  it("书签没有密码时 join 不带 password 选项", async () => {
    const { connection } = setup();
    /** MUC.join 收到的参数 */
    const joins: Array<[string, string, unknown]> = [];
    (connection as unknown as { XEP0045?: unknown }).XEP0045 = {
      join: (room: string, nick: string, options?: unknown) => {
        joins.push([room, nick, options]);
        return Promise.resolve();
      },
    };
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result">
        <pubsub xmlns="http://jabber.org/protocol/pubsub">
          <items node="urn:xmpp:bookmarks:1">
            <item id="orchard@conference.shakespeare.lit">
              <conference xmlns="urn:xmpp:bookmarks:1" autojoin="true"/>
            </item>
          </items>
        </pubsub>
      </iq>`,
    );

    connection.emit("session:start");

    await vi.waitFor(() => expect(joins).toHaveLength(1));
    expect(joins[0][2]).toBeUndefined();
  });
});
