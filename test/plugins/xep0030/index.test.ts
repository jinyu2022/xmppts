import { describe, expect, it, vi } from "vitest";
import { XEP0030 } from "../../../lib/plugins/xep0030";
import { Disco } from "../../../lib/plugins/xep0030/disco";
import type { Connection } from "../../../lib/connection";
import { XMPPError } from "../../../lib/errors";
import { Parser } from "../../../lib/ltx/Parser";
import { Iq } from "../../../lib/stanza";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0030 插件入口测试：会话门控、查询复用与快照副本。
 * 用例取自 §3/§4 的规范示例。
 *
 * @see https://xmpp.org/extensions/xep-0030.html 2.5.0 §3 Service Discovery Information
 */
describe("XEP0030 插件入口", () => {
  /** Example 2：服务器 disco#info 应答的简化版 */
  const SERVER_INFO = `
    <iq type="result" from="shakespeare.lit" to="romeo@montague.net/orchard" id="info1">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="server" type="im" name="Shakespeare IM"/>
        <feature var="urn:xmpp:ping"/>
      </query>
    </iq>
  `;

  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0030(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("初始化不发请求；session:start 自动发现一次", () => {
    const { connection } = setup();
    const sendAsync = vi.spyOn(connection, "sendAsync");
    expect(sendAsync).not.toHaveBeenCalled();

    connection.sessionActive = true;
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    connection.emit("session:start");
    expect(sendAsync).toHaveBeenCalledTimes(1);
  });

  it("会话未就绪：getter 直接拒绝且不发送查询", async () => {
    const { connection, plugin } = setup();
    const sendAsync = vi.spyOn(connection, "sendAsync");

    await expect(plugin.getServerFeatures()).rejects.toThrow("会话尚未就绪");
    await expect(plugin.getServerIdentities()).rejects.toThrow("会话尚未就绪");
    expect(sendAsync).not.toHaveBeenCalled();
  });

  it("会话就绪：并发 getter 复用同一次查询并返回副本", async () => {
    const { connection, plugin } = setup();
    connection.sessionActive = true;
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    const sendAsync = vi.spyOn(connection, "sendAsync");

    const [features, identities] = await Promise.all([
      plugin.getServerFeatures(),
      plugin.getServerIdentities(),
    ]);
    expect(sendAsync).toHaveBeenCalledTimes(1);
    expect(features.has("urn:xmpp:ping")).toBe(true);
    expect(identities).toEqual([
      { category: "server", type: "im", name: "Shakespeare IM", lang: undefined },
    ]);

    // 返回值是快照副本，外部修改不影响后续查询
    features.add("urn:xmpp:fake");
    const again = await plugin.getServerFeatures();
    expect(again.has("urn:xmpp:fake")).toBe(false);
    expect(sendAsync).toHaveBeenCalledTimes(1);
  });

  it("会话结束：已查询过也不返回旧快照", async () => {
    const { connection, plugin } = setup();
    connection.sessionActive = true;
    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    await plugin.getServerFeatures();

    connection.sessionActive = false;
    await expect(plugin.getServerFeatures()).rejects.toThrow("会话尚未就绪");
  });

  it("服务器返回 IQ error：reject 且下次调用重新查询", async () => {
    const { connection, plugin } = setup();
    connection.sessionActive = true;
    connection.sendAsyncResult = Parser.parse(
      `<iq type="error" id="info1"><error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`
    );
    const sendAsync = vi.spyOn(connection, "sendAsync");

    await expect(plugin.getServerFeatures()).rejects.toBeInstanceOf(XMPPError);

    connection.sendAsyncResult = Parser.parse(SERVER_INFO);
    await expect(plugin.getServerFeatures()).resolves.toBeInstanceOf(Set);
    expect(sendAsync).toHaveBeenCalledTimes(2);
  });

  describe("disco 查询与缓存", () => {
    const INFO_RESULT = `<iq type="result">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="client" type="pc" name="X"/>
        <feature var="urn:xmpp:ping"/>
      </query>
    </iq>`;
    const ITEMS_RESULT = `<iq type="result">
      <query xmlns="http://jabber.org/protocol/disco#items">
        <item jid="a@capulet.lit" name="A"/>
      </query>
    </iq>`;

    it("查询结果写入缓存，node 单独建键，cache=false 跳过缓存", async () => {
      const { connection, plugin } = setup();
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        const query = stanza.getElementsByTagName("query")[0];
        return Promise.resolve(
          Parser.parse(
            query.namespaceURI === "http://jabber.org/protocol/disco#info"
              ? INFO_RESULT
              : ITEMS_RESULT,
          ),
        );
      };

      const info = await plugin.getDiscoInfo("capulet.lit");
      expect(info.features.has("urn:xmpp:ping")).toBe(true);
      expect(connection.sentAsync).toHaveLength(1);

      // 相同目标与 node 命中缓存
      await plugin.getDiscoInfo("capulet.lit");
      expect(connection.sentAsync).toHaveLength(1);

      // node 参与缓存键
      await plugin.getDiscoInfo("capulet.lit", "node-1");
      expect(connection.sentAsync).toHaveLength(2);

      // 显式跳过缓存
      await plugin.getDiscoInfo("capulet.lit", undefined, false);
      expect(connection.sentAsync).toHaveLength(3);

      const items = await plugin.getDiscoItems("capulet.lit");
      expect(items[0].jid).toBe("a@capulet.lit");
      await plugin.getDiscoItems("capulet.lit");
      expect(connection.sentAsync).toHaveLength(4);
    });

    it("error 应答分别抛 XMPPError", async () => {
      const { connection, plugin } = setup();
      connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);

      await expect(plugin.getDiscoInfo("capulet.lit")).rejects.toBeInstanceOf(
        XMPPError,
      );
      await expect(plugin.getDiscoItems("capulet.lit")).rejects.toBeInstanceOf(
        XMPPError,
      );
    });

    it("缓存超过 100 条时淘汰最旧条目", async () => {
      const { connection, plugin } = setup();
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        return Promise.resolve(Parser.parse(INFO_RESULT));
      };

      // 时间戳严格递增：同毫秒插入时淘汰顺序会依赖排序实现的稳定性
      const now = vi.spyOn(Date, "now");
      let tick = 1_000_000;
      now.mockImplementation(() => tick++);
      try {
        for (let i = 0; i < 101; i++) {
          await plugin.getDiscoInfo(`user${i}@capulet.lit`);
        }
        const sent = connection.sentAsync.length;

        // 最早的 user0 已被淘汰，需重新查询
        await plugin.getDiscoInfo("user0@capulet.lit");
        expect(connection.sentAsync.length).toBe(sent + 1);
      } finally {
        now.mockRestore();
      }
    });

    it("items 缓存同样按 node 建键并在超限时淘汰", async () => {
      const { connection, plugin } = setup();
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        return Promise.resolve(Parser.parse(ITEMS_RESULT));
      };

      // 整个用例共用严格递增的时间戳，避免真实时间戳与 mock 值混排影响淘汰顺序
      const now = vi.spyOn(Date, "now");
      let tick = 1_000_000;
      now.mockImplementation(() => tick++);
      try {
        await plugin.getDiscoItems("capulet.lit", "node-1");
        // node 参与缓存键
        await plugin.getDiscoItems("capulet.lit", "node-2");
        expect(connection.sentAsync).toHaveLength(2);

        for (let i = 0; i < 101; i++) {
          await plugin.getDiscoItems(`user${i}@capulet.lit`, "node");
        }
        const sent = connection.sentAsync.length;

        await plugin.getDiscoItems("user0@capulet.lit", "node");
        expect(connection.sentAsync.length).toBe(sent + 1);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe("响应他人的 disco 查询", () => {
    it("仅对 get 类型的 disco#info/#items 直接子元素回复", () => {
      const { connection, plugin } = setup();
      plugin.addIdentity("client", "pc", "X");
      plugin.addFeature("urn:xmpp:ping");
      plugin.addItem("a@capulet.lit", "node", "A");

      const makeIq = (xml: string) =>
        new Iq(Parser.parse(xml), connection as unknown as Connection);

      connection.emit(
        "iq",
        makeIq(`<iq from="juliet@capulet.lit/balcony" id="i1" type="get">
          <query xmlns="http://jabber.org/protocol/disco#info"/>
        </iq>`),
      );
      connection.emit(
        "iq",
        makeIq(`<iq from="juliet@capulet.lit/balcony" id="i2" type="get">
          <query xmlns="http://jabber.org/protocol/disco#items"/>
        </iq>`),
      );
      // 无关命名空间、非 get、无 query 子元素均不回复
      connection.emit(
        "iq",
        makeIq(`<iq from="juliet@capulet.lit/balcony" id="i3" type="get">
          <query xmlns="urn:example:other"/>
        </iq>`),
      );
      connection.emit(
        "iq",
        makeIq(`<iq from="juliet@capulet.lit/balcony" id="i4" type="set">
          <query xmlns="http://jabber.org/protocol/disco#info"/>
        </iq>`),
      );
      connection.emit(
        "iq",
        makeIq(`<iq from="juliet@capulet.lit/balcony" id="i5" type="get">
          <ping xmlns="urn:xmpp:ping"/>
        </iq>`),
      );

      expect(connection.sent).toHaveLength(2);
      expect(connection.sent[0].getAttribute("type")).toBe("result");
      expect(connection.sent[0].getAttribute("id")).toBe("i1");
      expect(connection.sent[1].getAttribute("id")).toBe("i2");

      // 回复内容来自本地 disco 数据（init 自身也会加入 disco 特性）
      const infoQuery = connection.sent[0].getElementsByTagNameNS(
        Disco.NS.DISCO_INFO,
        "query",
      )[0];
      const features = Array.from(infoQuery.getElementsByTagName("feature")).map(
        (feature) => feature.getAttribute("var"),
      );
      expect(features).toContain("urn:xmpp:ping");
      expect(
        infoQuery.getElementsByTagName("identity")[0].getAttribute("category"),
      ).toBe("client");

      const itemsQuery = connection.sent[1].getElementsByTagNameNS(
        Disco.NS.DISCO_ITEMS,
        "query",
      )[0];
      expect(itemsQuery.getElementsByTagName("item")[0].getAttribute("jid")).toBe(
        "a@capulet.lit",
      );
    });
  });

  describe("本地特性、身份与项目", () => {
    it("特性与身份的增删及重复校验", () => {
      const { plugin } = setup();

      plugin.addFeature("urn:xmpp:ping");
      expect(plugin.removeFeature("urn:xmpp:ping")).toBe(true);
      expect(plugin.removeFeature("urn:xmpp:ping")).toBe(false);

      plugin.addIdentity("client", "pc", "X", "zh");
      expect(() => plugin.addIdentity("client", "pc", "Y", "zh")).toThrow(
        "已经存在相同身份标识: client/pc/zh",
      );
      plugin.removeIdentity("client", "pc", "zh");
      expect(plugin.identities).toHaveLength(0);
    });

    it("项目增删及重复校验（node/name 参与判定）", () => {
      const { plugin } = setup();

      plugin.addItem("a@capulet.lit", "node", "A");
      expect(() => plugin.addItem("a@capulet.lit", "node", "A")).toThrow(
        "已经存在相同的项目: a@capulet.lit/node/A",
      );
      plugin.removeItem("a@capulet.lit", "A");
      expect(plugin.items).toHaveLength(0);
    });
  });
});
