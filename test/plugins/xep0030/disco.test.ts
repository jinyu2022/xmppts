import { describe, it, expect } from "vitest";
import { Disco } from "../../../lib/plugins/xep0030/disco";
import XEP0030 from "../../../lib/plugins/xep0030";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0030: Service Discovery
 * @see https://xmpp.org/extensions/xep-0030.html
 * @version 2.5.0 (2024-04-30)
 *
 * 用例取自 §3/§4 的规范示例：服务器下发的（Example 2/6/8/10/12/15/17/21）测解析，
 * 本地 API 构造的应答与示例对齐；其余按 §11 XML Schema 推导补充。
 */
describe("XEP-0030", () => {
  /** Example 2：plays.shakespeare.lit 的 disco#info 应答 */
  const EXAMPLE_2 = `
    <iq type="result" from="plays.shakespeare.lit" to="romeo@montague.net/orchard" id="info1">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="conference" type="text" name="Play-Specific Chatrooms"/>
        <identity category="directory" type="chatroom" name="Play-Specific Chatrooms"/>
        <feature var="http://jabber.org/protocol/disco#info"/>
        <feature var="http://jabber.org/protocol/disco#items"/>
        <feature var="jabber:iq:register"/>
        <feature var="jabber:iq:search"/>
        <feature var="jabber:iq:time"/>
        <feature var="jabber:iq:version"/>
      </query>
    </iq>
  `;

  /** Example 12：shakespeare.lit 的 disco#items 应答 */
  const EXAMPLE_12 = `
    <iq type="result" from="shakespeare.lit" to="romeo@montague.net/orchard" id="items1">
      <query xmlns="http://jabber.org/protocol/disco#items">
        <item jid="people.shakespeare.lit" name="Directory of Characters"/>
        <item jid="plays.shakespeare.lit" name="Play-Specific Chatrooms"/>
        <item jid="mim.shakespeare.lit" name="Gateway to Marlowe IM"/>
        <item jid="words.shakespeare.lit" name="Shakespearean Lexicon"/>
        <item jid="globe.shakespeare.lit" name="Calendar of Performances"/>
        <item jid="headlines.shakespeare.lit" name="Latest Shakespearean News"/>
        <item jid="catalog.shakespeare.lit" name="Buy Shakespeare Stuff!"/>
        <item jid="en2fr.shakespeare.lit" name="French Translation Service"/>
      </query>
    </iq>
  `;

  describe("parseDiscoInfo", () => {
    it("Example 2：解析多个 identity 与 feature 的应答", () => {
      const result = Disco.parseDiscoInfo(Parser.parse(EXAMPLE_2));
      expect(result.identities).toEqual([
        { category: "conference", type: "text", name: "Play-Specific Chatrooms", lang: undefined },
        { category: "directory", type: "chatroom", name: "Play-Specific Chatrooms", lang: undefined },
      ]);
      expect(result.features).toEqual(
        new Set([
          "http://jabber.org/protocol/disco#info",
          "http://jabber.org/protocol/disco#items",
          "jabber:iq:register",
          "jabber:iq:search",
          "jabber:iq:time",
          "jabber:iq:version",
        ])
      );
    });

    it("Example 6：解析服务器代 bare JID 应答的 account 身份", () => {
      const xml = Parser.parse(`
        <iq type="result" from="juliet@capulet.com" to="shakespeare.lit" id="info2">
          <query xmlns="http://jabber.org/protocol/disco#info">
            <identity category="account" type="registered"/>
            <feature var="http://jabber.org/protocol/disco#info"/>
          </query>
        </iq>
      `);
      const result = Disco.parseDiscoInfo(xml);
      expect(result.identities).toEqual([
        { category: "account", type: "registered", name: undefined, lang: undefined },
      ]);
    });

    it("Example 8：解析连接资源的 client 身份", () => {
      const xml = Parser.parse(`
        <iq type="result" from="romeo@montague.net/orchard" to="juliet@capulet.com/balcony" id="info4">
          <query xmlns="http://jabber.org/protocol/disco#info">
            <identity category="client" type="pc" name="Gabber"/>
            <feature var="http://jabber.org/protocol/disco#info"/>
          </query>
        </iq>
      `);
      const result = Disco.parseDiscoInfo(xml);
      expect(result.identities[0].category).toBe("client");
      expect(result.identities[0].type).toBe("pc");
    });

    it("Example 10：解析 JID+node 结果", () => {
      const xml = Parser.parse(`
        <iq type="result" from="mim.shakespeare.lit" to="romeo@montague.net/orchard" id="info3">
          <query xmlns="http://jabber.org/protocol/disco#info" node="http://jabber.org/protocol/commands">
            <identity category="automation" type="command-list"/>
            <feature var="http://jabber.org/protocol/disco#info"/>
          </query>
        </iq>
      `);
      const result = Disco.parseDiscoInfo(xml);
      expect(result.identities[0]).toEqual({
        category: "automation",
        type: "command-list",
        name: undefined,
        lang: undefined,
      });
    });

    it("§3.1：identity 可带 xml:lang", () => {
      const result = Disco.parseDiscoInfo(Parser.parse(`
        <query xmlns="http://jabber.org/protocol/disco#info">
          <identity category="client" type="pc" name="Pidgin" xml:lang="en"/>
        </query>
      `));
      expect(result.identities[0].lang).toBe("en");
    });

    it("缺少 query 元素时抛 Error", () => {
      expect(() => Disco.parseDiscoInfo(Parser.parse(`<x xmlns="other"/>`))).toThrow();
    });
  });

  describe("parseDiscoItems", () => {
    it("Example 12：解析全部 item 列表", () => {
      const items = Disco.parseDiscoItems(Parser.parse(EXAMPLE_12));
      expect(items).toHaveLength(8);
      expect(items[0]).toEqual({ jid: "people.shakespeare.lit", node: undefined, name: "Directory of Characters" });
      expect(items[7]).toEqual({ jid: "en2fr.shakespeare.lit", node: undefined, name: "French Translation Service" });
    });

    it("Example 15：解析代 bare JID 应答的资源 item", () => {
      const items = Disco.parseDiscoItems(Parser.parse(`
        <iq type="result" from="juliet@capulet.com" to="shakespeare.lit" id="items2">
          <query xmlns="http://jabber.org/protocol/disco#items">
            <item jid="juliet@capulet.com/balcony"/>
            <item jid="juliet@capulet.com/chamber"/>
          </query>
        </iq>
      `));
      expect(items).toEqual([
        { jid: "juliet@capulet.com/balcony", node: undefined, name: undefined },
        { jid: "juliet@capulet.com/chamber", node: undefined, name: undefined },
      ]);
    });

    it("Example 17：解析带 node 的 item", () => {
      const items = Disco.parseDiscoItems(Parser.parse(`
        <iq type="result" from="catalog.shakespeare.lit" to="romeo@montague.net/orchard" id="items2">
          <query xmlns="http://jabber.org/protocol/disco#items">
            <item jid="catalog.shakespeare.lit" node="books" name="Books by and about Shakespeare"/>
            <item jid="catalog.shakespeare.lit" node="clothing" name="Wear your literary taste with pride"/>
            <item jid="catalog.shakespeare.lit" node="music" name="Music from the time of Shakespeare"/>
          </query>
        </iq>
      `));
      expect(items[0]).toEqual({ jid: "catalog.shakespeare.lit", node: "books", name: "Books by and about Shakespeare" });
    });

    it("Example 13：空结果集", () => {
      const items = Disco.parseDiscoItems(Parser.parse(`
        <iq type="result" from="shakespeare.lit" to="romeo@montague.net/orchard" id="items1">
          <query xmlns="http://jabber.org/protocol/disco#items"/>
        </iq>
      `));
      expect(items).toEqual([]);
    });
  });

  describe("本地 feature / identity / item 管理", () => {
    it("添加与移除 feature", () => {
      const disco = createDisco();
      disco.addFeature("urn:xmpp:ping");
      expect(disco.features.has("urn:xmpp:ping")).toBe(true);
      disco.removeFeature("urn:xmpp:ping");
      expect(disco.features.has("urn:xmpp:ping")).toBe(false);
    });

    it("添加与移除 identity", () => {
      const disco = createDisco();
      disco.addIdentity("client", "pc", "Gabber");
      expect(disco.identities).toEqual([
        { category: "client", type: "pc", name: "Gabber", lang: undefined },
      ]);
      disco.removeIdentity("client", "pc");
      expect(disco.identities).toHaveLength(0);
    });

    it("添加与移除 item", () => {
      const disco = createDisco();
      disco.addItem("people.shakespeare.lit", undefined, "Directory of Characters");
      expect(disco.items).toEqual([
        { jid: "people.shakespeare.lit", node: undefined, name: "Directory of Characters" },
      ]);
      disco.removeItem("people.shakespeare.lit", "Directory of Characters");
      expect(disco.items).toHaveLength(0);
    });
  });

  describe("createInfoResult", () => {
    it("按 Example 2 的数据生成 info 应答并可解析回原值", () => {
      const identities = [
        { category: "conference", type: "text", name: "Play-Specific Chatrooms" },
        { category: "directory", type: "chatroom", name: "Play-Specific Chatrooms" },
      ];
      const features = ["http://jabber.org/protocol/disco#info", "jabber:iq:version"];
      const iq = Disco.createInfoResult(identities, features, "romeo@montague.net/orchard", "info1");
      expect(iq.getAttribute("type")).toBe("result");
      expect(iq.getAttribute("to")).toBe("romeo@montague.net/orchard");
      expect(iq.getAttribute("id")).toBe("info1");
      const result = Disco.parseDiscoInfo(iq);
      expect(result.identities).toEqual(identities.map((i) => ({ ...i, lang: undefined })));
      expect(result.features).toEqual(new Set(features));
    });
  });

  describe("createItemsResult", () => {
    it("按 Example 12 的数据生成 items 应答并可解析回原值", () => {
      const items = [
        { jid: "people.shakespeare.lit", name: "Directory of Characters" },
        { jid: "catalog.shakespeare.lit", node: "books", name: "Books by and about Shakespeare" },
      ];
      const iq = Disco.createItemsResult(items, "romeo@montague.net/orchard", "items1");
      expect(iq.getAttribute("type")).toBe("result");
      const parsed = Disco.parseDiscoItems(iq);
      expect(parsed).toEqual([
        { jid: "people.shakespeare.lit", node: undefined, name: "Directory of Characters" },
        { jid: "catalog.shakespeare.lit", node: "books", name: "Books by and about Shakespeare" },
      ]);
    });

    it("带 queryNode 时只返回该节点下的 item", () => {
      const items = [
        { jid: "catalog.shakespeare.lit", node: "music", name: "Music" },
        { jid: "catalog.shakespeare.lit", node: "books", name: "Books" },
      ];
      const iq = Disco.createItemsResult(items, "romeo@montague.net/orchard", "items2", "music");
      const query = iq.getElementsByTagNameNS(Disco.NS.DISCO_ITEMS, "query")[0];
      expect(query.getAttribute("node")).toBe("music");
      expect(Disco.parseDiscoItems(iq)).toEqual([
        { jid: "catalog.shakespeare.lit", node: "music", name: "Music" },
      ]);
    });
  });
});

/** 用于自身 disco 数据用例的插件实例，不建立连接 */
function createDisco() {
  return new XEP0030(new Connection("juliet@capulet.com/balcony", "test123"));
}
