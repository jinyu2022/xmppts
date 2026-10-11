import { describe, it, expect } from "vitest";
import { Bookmarks } from "../../../lib/plugins/xep0402/bookmarks";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0402: PEP Native Bookmarks
 * @see https://xmpp.org/extensions/xep-0402.html
 * @version 1.2.0 (2024-08-15)
 *
 * 用例取自 §2 Example 1（conference 元素）与 Example 2（最小元素）、
 * §3.2 Example 4（检索书签）、§3.3 Example 6（添加书签）、§3.5 Example 10（删除书签）。
 */
describe("Bookmarks", () => {
  // §2 Example 1：带 name/autojoin 与 nick 的 conference
  const EXAMPLE_1_CONFERENCE = `
    <conference xmlns='urn:xmpp:bookmarks:1' name='Council of Oberon' autojoin='true'>
      <nick>Puck</nick>
    </conference>`;
  // §2 Example 2：最小合法 conference
  const EXAMPLE_2_CONFERENCE = `<conference xmlns='urn:xmpp:bookmarks:1'/>`;

  describe("createRetrieveBookmarksIq", () => {
    it("Example 4：生成检索书签的 get IQ", () => {
      const iq = Bookmarks.createRetrieveBookmarksIq("juliet@capulet.lit");
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("juliet@capulet.lit");
      expect(iq.getElementsByTagName("items")[0].getAttribute("node")).toBe(Bookmarks.NS);
    });
  });

  describe("parseConferenceEl", () => {
    it("Example 1：解析 name/autojoin/nick", () => {
      const el = Parser.parse(EXAMPLE_1_CONFERENCE);
      const result = Bookmarks.parseConferenceEl(el);
      expect(result.conference.name).toBe("Council of Oberon");
      expect(result.conference.autojoin).toBe(true);
      expect(result.conference.nick).toBe("Puck");
    });

    it("Example 2：最小元素解析出空字段", () => {
      const el = Parser.parse(EXAMPLE_2_CONFERENCE);
      const result = Bookmarks.parseConferenceEl(el);
      expect(result.conference.name).toBeUndefined();
      expect(result.conference.autojoin).toBe(false);
      expect(result.conference.nick).toBeUndefined();
    });

    it("非 conference 元素时抛错", () => {
      const el = Parser.parse(`<foo xmlns="urn:xmpp:bookmarks:1"/>`);
      expect(() => Bookmarks.parseConferenceEl(el)).toThrow("不是一个conference元素");
    });
  });

  describe("createAddBookmarkIq", () => {
    it("Example 6：生成携带 publish-options 的发布 IQ", () => {
      const iq = Bookmarks.createAddBookmarkIq(
        {
          jid: "theplay@conference.shakespeare.lit",
          name: "The Play's the Thing",
          autojoin: true,
          nick: "JC",
        },
        Bookmarks.createPublishOptionsEl()
      );
      const item = iq.getElementsByTagName("item")[0];
      const conferenceEl = iq.getElementsByTagNameNS(Bookmarks.NS, "conference")[0];
      expect(iq.getAttribute("type")).toBe("set");
      expect(item.getAttribute("id")).toBe("theplay@conference.shakespeare.lit");
      expect(conferenceEl.getAttribute("name")).toBe("The Play's the Thing");
      expect(conferenceEl.getElementsByTagName("nick")[0].textContent).toBe("JC");
      expect(iq.getElementsByTagName("publish-options")).toHaveLength(1);
    });

    it("不传 publish-options 时不生成该元素", () => {
      const iq = Bookmarks.createAddBookmarkIq({
        jid: "theplay@conference.shakespeare.lit",
      });
      expect(iq.getElementsByTagName("publish-options")).toHaveLength(0);
    });
  });

  describe("createPublishOptionsEl", () => {
    // §3.3 Example 6：FORM_TYPE 为 pubsub#publish-options，前提条件要求私有且持久化
    it("按 Example 6 生成前提条件表单", () => {
      const options = Bookmarks.createPublishOptionsEl();
      expect(options.tagName).toBe("publish-options");
      const form = options.getElementsByTagName("x")[0];
      expect(form.getAttribute("type")).toBe("submit");

      const fields = Array.from(options.getElementsByTagName("field"));
      const fieldValues = (name: string) =>
        fields
          .find((field) => field.getAttribute("var") === name)!
          .getElementsByTagName("value")[0].textContent;
      expect(fieldValues("FORM_TYPE")).toBe(
        "http://jabber.org/protocol/pubsub#publish-options"
      );
      expect(fieldValues("pubsub#persist_items")).toBe("true");
      expect(fieldValues("pubsub#max_items")).toBe("max");
      expect(fieldValues("pubsub#send_last_published_item")).toBe("never");
      expect(fieldValues("pubsub#access_model")).toBe("whitelist");
    });
  });

  describe("createNodeConfigForm", () => {
    // §8.2.4：owner 配置节点用的 #node_config 表单，字段值与发布前提条件一致
    it("生成 #node_config 提交表单", () => {
      const form = Bookmarks.createNodeConfigForm();
      expect(form.getAttribute("type")).toBe("submit");

      const fields = Array.from(form.getElementsByTagName("field"));
      const fieldValues = (name: string) =>
        fields
          .find((field) => field.getAttribute("var") === name)!
          .getElementsByTagName("value")[0].textContent;
      expect(fieldValues("FORM_TYPE")).toBe(
        "http://jabber.org/protocol/pubsub#node_config"
      );
      expect(fieldValues("pubsub#access_model")).toBe("whitelist");
      expect(fieldValues("pubsub#persist_items")).toBe("true");
    });
  });

  describe("createDeleteBookmarkIq", () => {
    it("Example 10：生成带 notify 的撤回 IQ", () => {
      const iq = Bookmarks.createDeleteBookmarkIq("theplay@conference.shakespeare.lit");
      const retract = iq.getElementsByTagName("retract")[0];
      expect(iq.getAttribute("type")).toBe("set");
      expect(retract.getAttribute("node")).toBe(Bookmarks.NS);
      expect(retract.getAttribute("notify")).toBe("true");
      expect(retract.getElementsByTagName("item")[0].getAttribute("id")).toBe(
        "theplay@conference.shakespeare.lit"
      );
    });
  });
});
