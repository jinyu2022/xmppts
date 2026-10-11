import { describe, it, expect } from "vitest";
import { Pubsub } from "../../../lib/plugins/xep0060/pubsub";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPElement } from "../../../lib/ltx/Element";

/**
 * XEP-0060: Publish-Subscribe
 * @see https://xmpp.org/extensions/xep-0060.html
 * @version 1.30.0 (2025-11-11)
 *
 * 用例取自规范原文：服务器下发的 event/items 通知用于解析（§1.2 Example 2/3、§7.1.2.1 Example 100、
 * §7.2.2.1 Example 117、§8.2.5.3 Example 151、§8.4.2 Example 160、§8.5.2 Example 165、
 * §12.19 Example 222）；查询结果解析用 §5.6.1 Example 21、§8.9.1.2 Example 198、§6.5.3 Example 75；
 * 客户端发出的 publish/retract/items 请求用于构造（§7.1.1 Example 96/97、§7.2.1 Example 115、
 * §6.5.2 Example 74、§6.5.7 Example 80、§6.5.8 Example 83）。
 */
describe("Pubsub (XEP-0060)", () => {
  // §1.2 Example 2：服务通知订阅者，带 payload 的 items 事件
  const EXAMPLE_2_EVENT = `
    <message from='pubsub.shakespeare.lit' to='francisco@denmark.lit' id='foo'>
      <event xmlns='http://jabber.org/protocol/pubsub#event'>
        <items node='princely_musings'>
          <item id='ae890ac52d0df67ed7cfdf51b644e901'>
            <entry xmlns='http://www.w3.org/2005/Atom'>
              <title>Soliloquy</title>
            </entry>
          </item>
        </items>
      </event>
    </message>`;
  // §1.2 Example 3：瞬态通知，无 payload 的空 items
  const EXAMPLE_3_EVENT = `
    <message from='pubsub.shakespeare.lit' to='francisco@denmark.lit'>
      <event xmlns='http://jabber.org/protocol/pubsub#event'>
        <items node='elsinore/doorbell'/>
      </event>
    </message>`;
  // §7.1.2.1 Example 100：服务下发带 payload 的事件（取第一条）
  const EXAMPLE_100_EVENT = `
    <message from='pubsub.shakespeare.lit' to='francisco@denmark.lit' id='foo'>
      <event xmlns='http://jabber.org/protocol/pubsub#event'>
        <items node='princely_musings'>
          <item id='ae890ac52d0df67ed7cfdf51b644e901'>
            <entry xmlns='http://www.w3.org/2005/Atom'>
              <title>Soliloquy</title>
            </entry>
          </item>
        </items>
      </event>
    </message>`;
  // §7.2.2.1 Example 117：服务下发撤回通知
  const EXAMPLE_117_EVENT = `
    <message from='pubsub.shakespeare.lit' to='francisco@denmark.lit' id='foo'>
      <event xmlns='http://jabber.org/protocol/pubsub#event'>
        <items node='princely_musings'>
          <retract id='ae890ac52d0df67ed7cfdf51b644e901'/>
        </items>
      </event>
    </message>`;
  // §7.1.1 Example 96：客户端发布带 ItemID 的 item（publish 子元素）
  const EXAMPLE_96_PUBLISH = `
    <publish xmlns='http://jabber.org/protocol/pubsub' node='princely_musings'>
      <item id='bnd81g37d61f49fgn581'>
        <entry xmlns='http://www.w3.org/2005/Atom'>
          <title>Soliloquy</title>
        </entry>
      </item>
    </publish>`;
  // §7.1.1 Example 97：客户端发布不带 ItemID 的 item
  const EXAMPLE_97_PUBLISH = `
    <publish xmlns='http://jabber.org/protocol/pubsub' node='princely_musings'>
      <item>
        <entry xmlns='http://www.w3.org/2005/Atom'>
          <title>Soliloquy</title>
        </entry>
      </item>
    </publish>`;

  describe("parseEventEl", () => {
    it("Example 2：解析带 payload 的 items 事件", () => {
      const eventEl = Parser.parse(EXAMPLE_2_EVENT).getElementsByTagName("event")[0];
      const result = Pubsub.parseEventEl(eventEl);
      expect(result.event.node).toBe("princely_musings");
      expect(result.event.item?.id).toBe("ae890ac52d0df67ed7cfdf51b644e901");
    });

    it("Example 3：解析无 payload 的瞬态通知", () => {
      const eventEl = Parser.parse(EXAMPLE_3_EVENT).getElementsByTagName("event")[0];
      const result = Pubsub.parseEventEl(eventEl);
      expect(result.event.node).toBe("elsinore/doorbell");
      expect(result.event.items).toBeUndefined();
    });

    it("Example 100：payload 挂在 item 的 localName 键下", () => {
      const eventEl = Parser.parse(EXAMPLE_100_EVENT).getElementsByTagName("event")[0];
      const result = Pubsub.parseEventEl(eventEl);
      expect(result.event.item?.entry).toBeDefined();
    });

    it("Example 117：解析 retract 通知", () => {
      const eventEl = Parser.parse(EXAMPLE_117_EVENT).getElementsByTagName("event")[0];
      const result = Pubsub.parseEventEl(eventEl);
      expect(result.event.retracts).toEqual(["ae890ac52d0df67ed7cfdf51b644e901"]);
      expect(result.event.items).toBeUndefined();
    });

    it("非 event 命名空间时抛错", () => {
      expect(() => Pubsub.parseEventEl(Parser.parse("<iq/>"))).toThrow();
    });
  });

  describe("parseEventEl 的五个单一分支", () => {
    /** 解析 `<message>` 内的 `<event/>` */
    const parseEvent = (eventXml: string) =>
      Pubsub.parseEventEl(
        Parser.parse(`<message>${eventXml}</message>`).getElementsByTagName("event")[0],
      ).event;

    it("§8.4.2 Example 160：delete 取 redirect 的 uri，不保留元素", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <delete node="princely_musings">
            <redirect uri="xmpp:hamlet@denmark.lit?;node=blog"/>
          </delete>
        </event>`,
      );
      expect(event.type).toBe("delete");
      expect(event.node).toBe("princely_musings");
      expect(event.redirect).toBe("xmpp:hamlet@denmark.lit?;node=blog");
      // 同命名空间的元素不得出现在返回值里：转换层会把它再次投给同一 parser
      expect("delete" in event).toBe(false);
    });

    it("§8.2.5.3 Example 151：configuration 取内层数据表单", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <configuration node="princely_musings">
            <x xmlns="jabber:x:data" type="result"/>
          </configuration>
        </event>`,
      );
      expect(event.type).toBe("configuration");
      expect(event.form?.localName).toBe("x");
      expect("configuration" in event).toBe(false);
    });

    it("§8.5.2 Example 165：purge 只有 node", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <purge node="princely_musings"/>
        </event>`,
      );
      expect(event.type).toBe("purge");
      expect(event.node).toBe("princely_musings");
    });

    it("§12.19 Example 222：subscription 取属性，含租约 expiry", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <subscription expiry="2006-02-28T23:59:59Z"
                        jid="francisco@denmark.lit"
                        node="princely_musings"
                        subid="ba49252aaa4f5d320c24d3766f0bdcade78c78d3"
                        subscription="subscribed"/>
        </event>`,
      );
      expect(event.type).toBe("subscription");
      expect(event.jid).toBe("francisco@denmark.lit");
      expect(event.subid).toBe("ba49252aaa4f5d320c24d3766f0bdcade78c78d3");
      expect(event.subscription).toBe("subscribed");
      expect(event.expiry).toBe("2006-02-28T23:59:59Z");
    });

    it("XEP-0248 §4：collection 取 associate/disassociate 的 node", () => {
      const associate = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <collection node="urn:xmpp:example:1"><associate node="urn:xmpp:example:2"/></collection>
        </event>`,
      );
      expect(associate.associate).toBe("urn:xmpp:example:2");
      expect(associate.disassociate).toBeUndefined();

      const disassociate = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <collection node="urn:xmpp:example:1"><disassociate node="urn:xmpp:example:2"/></collection>
        </event>`,
      );
      expect(disassociate.disassociate).toBe("urn:xmpp:example:2");
      expect(disassociate.associate).toBeUndefined();
    });

    it("未列举的子元素归入 unknown，且只取该元素自己的 node", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <future-thing node="urn:xmpp:example:1"/>
        </event>`,
      );
      expect(event.type).toBe("unknown");
      expect(event.node).toBe("urn:xmpp:example:1");
    });

    it("其它命名空间的首个子元素不参与 node 兜底", () => {
      const event = parseEvent(
        `<event xmlns="http://jabber.org/protocol/pubsub#event">
          <foreign xmlns="urn:example:ext" node="urn:example:wrong"/>
          <purge/>
        </event>`,
      );
      expect(event.type).toBe("purge");
      expect(event.node).toBeUndefined();
    });
  });

  describe("parseItems / parseSubscriptions / parseAffiliations", () => {
    it("§6.5.3 Example 75：按载荷根元素 localName 挂载", () => {
      const itemsEl = Parser.parse(
        `<items xmlns="http://jabber.org/protocol/pubsub" node="princely_musings">
          <item id="368866411b877c30064a5f62b917cffe">
            <entry xmlns="http://www.w3.org/2005/Atom"/>
          </item>
          <item id="4e30f35051b7b8b42abe083742187228">
            <entry xmlns="http://www.w3.org/2005/Atom"/>
          </item>
        </items>`,
      );
      const items = Pubsub.parseItems(itemsEl);
      expect(items.node).toBe("princely_musings");
      expect(items.items).toHaveLength(2);
      expect(items.items[0].id).toBe("368866411b877c30064a5f62b917cffe");
      expect(items.items[0].entry).toBeDefined();
      expect(items.retracts).toEqual([]);
    });

    it("§7.1.2.1：事件通知的 <items/>（pubsub#event 命名空间）同样可解析", () => {
      const itemsEl = Parser.parse(
        `<items xmlns="http://jabber.org/protocol/pubsub#event" node="elsinore/doorbell"></items>`,
      );
      expect(Pubsub.parseItems(itemsEl)).toEqual({
        node: "elsinore/doorbell",
        items: [],
        retracts: [],
      });
    });

    it("传入其它元素或其它命名空间时抛错，不代为查找子元素", () => {
      expect(() =>
        Pubsub.parseItems(Parser.parse(`<pubsub xmlns="http://jabber.org/protocol/pubsub"></pubsub>`)),
      ).toThrow("不是一个items元素");
      expect(() =>
        Pubsub.parseItems(Parser.parse(`<items xmlns="urn:example:ext"></items>`)),
      ).toThrow("不是一个items元素");
    });

    it("§5.6.1 Example 21：解析 <subscriptions/>，node 取容器属性", () => {
      const subscriptionsEl = Parser.parse(
        `<subscriptions xmlns="http://jabber.org/protocol/pubsub" node="node6">
          <subscription jid="francisco@denmark.lit" subscription="subscribed" subid="123-abc"/>
          <subscription jid="francisco@denmark.lit" subscription="subscribed" subid="004-yyy"/>
        </subscriptions>`,
      );
      expect(Pubsub.parseSubscriptions(subscriptionsEl)).toEqual([
        {
          node: "node6",
          jid: "francisco@denmark.lit",
          subscription: "subscribed",
          subid: "123-abc",
        },
        {
          node: "node6",
          jid: "francisco@denmark.lit",
          subscription: "subscribed",
          subid: "004-yyy",
        },
      ]);
    });

    it("§6.1.2：订阅响应里单独返回的 <subscription/> 直接解析", () => {
      const subscriptionEl = Parser.parse(
        `<subscription xmlns="http://jabber.org/protocol/pubsub" node="princely_musings"
                       jid="francisco@denmark.lit" subscription="subscribed"/>`,
      );
      expect(Pubsub.parseSubscriptions(subscriptionEl)).toEqual([
        { node: "princely_musings", jid: "francisco@denmark.lit", subscription: "subscribed" },
      ]);
    });

    it("§8.9.1.2 Example 198：解析 <affiliations/>", () => {
      const affiliationsEl = Parser.parse(
        `<affiliations xmlns="http://jabber.org/protocol/pubsub#owner" node="princely_musings">
          <affiliation jid="hamlet@denmark.lit" affiliation="owner"/>
          <affiliation jid="polonius@denmark.lit" affiliation="outcast"/>
        </affiliations>`,
      );
      expect(Pubsub.parseAffiliations(affiliationsEl)).toEqual([
        { node: "princely_musings", jid: "hamlet@denmark.lit", affiliation: "owner" },
        { node: "princely_musings", jid: "polonius@denmark.lit", affiliation: "outcast" },
      ]);
    });

    it("传入其它元素或其它命名空间时抛错", () => {
      expect(() =>
        Pubsub.parseSubscriptions(Parser.parse(`<subscriptions xmlns="urn:example:ext"></subscriptions>`)),
      ).toThrow("不是一个subscriptions元素");
      expect(() =>
        Pubsub.parseAffiliations(Parser.parse(`<affiliations xmlns="urn:example:ext"></affiliations>`)),
      ).toThrow("不是一个affiliations元素");
    });
  });

  describe("createRetrieveItemsIq", () => {
    it("Example 74：检索全部 items 的 get IQ", () => {
      const iq = Pubsub.createRetrieveItemsIq("pubsub.shakespeare.lit", "princely_musings");
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("pubsub.shakespeare.lit");
      const pubsubEl = iq.getElementsByTagName("pubsub")[0];
      expect(pubsubEl.namespaceURI).toBe(Pubsub.NS.BASE);
      expect(pubsubEl.getElementsByTagName("items")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 80：指定 max_items", () => {
      const iq = Pubsub.createRetrieveItemsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        2,
      );
      const itemsEl = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("items")[0];
      expect(itemsEl.getAttribute("max_items")).toBe("2");
    });

    it("max 非正数不写出 max_items（§17.1 模式为 xs:positiveInteger）", () => {
      const iq = Pubsub.createRetrieveItemsIq("pubsub.shakespeare.lit", "princely_musings", -1);
      const itemsEl = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("items")[0];
      expect(itemsEl.getAttribute("max_items")).toBeNull();
    });

    it("Example 83：按 ItemID 检索单项（itemIds 数组）", () => {
      const iq = Pubsub.createRetrieveItemsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        undefined,
        ["ae890ac52d0df67ed7cfdf51b644e901"],
      );
      const itemEl = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("item")[0];
      expect(itemEl.getAttribute("id")).toBe("ae890ac52d0df67ed7cfdf51b644e901");
    });

    it("Example 78：一次按多个 ItemID 检索（§6.5.6 MUST allow multiple items）", () => {
      const iq = Pubsub.createRetrieveItemsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        undefined,
        ["368866411b877c30064a5f62b917cffe", "4e30f35051b7b8b42abe083742187228"],
      );
      const itemEls = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("item");
      expect(itemEls).toHaveLength(2);
      expect(itemEls[0].getAttribute("id")).toBe("368866411b877c30064a5f62b917cffe");
      expect(itemEls[1].getAttribute("id")).toBe("4e30f35051b7b8b42abe083742187228");
    });
  });

  describe("createPublishIq", () => {
    it("Example 96：携带 ItemID 的 publish 请求", () => {
      const publishEl = Parser.parse(EXAMPLE_96_PUBLISH);
      const iq = Pubsub.createPublishIq(publishEl);
      expect(iq.getAttribute("type")).toBe("set");
      const pubsubEl = iq.getElementsByTagName("pubsub")[0];
      expect(pubsubEl.namespaceURI).toBe(Pubsub.NS.BASE);
      expect(pubsubEl.getElementsByTagName("publish")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 97：不带 ItemID 的 publish 请求", () => {
      const publishEl = Parser.parse(EXAMPLE_97_PUBLISH);
      const iq = Pubsub.createPublishIq(publishEl);
      const itemEl = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("item")[0];
      expect(itemEl.getAttribute("id")).toBeNull();
    });

    it("可指定目标服务", () => {
      const iq = Pubsub.createPublishIq(
        Parser.parse(EXAMPLE_96_PUBLISH),
        undefined,
        "pubsub.shakespeare.lit",
      );
      expect(iq.getAttribute("to")).toBe("pubsub.shakespeare.lit");
    });
  });

  describe("createPublishOptionsEl", () => {
    // §7.1.5 Example 114：前提条件先与节点配置比对，FORM_TYPE 为 #publish-options
    it("把配置项写成注册字段，布尔值写出 true", () => {
      const options = Pubsub.createPublishOptionsEl({
        accessModel: "presence",
        persistItems: true,
      });
      expect(options.tagName).toBe("publish-options");
      const form = options.getElementsByTagName("x")[0];
      expect(form.getAttribute("type")).toBe("submit");

      const fields = Array.from(options.getElementsByTagName("field"));
      expect(fields.map((field) => field.getAttribute("var"))).toEqual([
        "FORM_TYPE",
        "pubsub#access_model",
        "pubsub#persist_items",
      ]);
      expect(fields[0].getAttribute("type")).toBe("hidden");
      expect(fields[0].getElementsByTagName("value")[0].textContent).toBe(
        Pubsub.FORM_TYPE.PUBLISH_OPTIONS,
      );
      expect(fields[1].getElementsByTagName("value")[0].textContent).toBe("presence");
      expect(fields[2].getElementsByTagName("value")[0].textContent).toBe("true");
    });

    it("未给出的配置项不写成前提条件", () => {
      const options = Pubsub.createPublishOptionsEl({});
      expect(options.getElementsByTagName("field")).toHaveLength(1);
    });
  });

  describe("createNodeConfigForm", () => {
    // §8.2.4 Example 146：owner 提交的配置表单，FORM_TYPE 为 #node_config
    it("多值字段展开为多个 value", () => {
      const form = Pubsub.createNodeConfigForm({
        accessModel: "whitelist",
        rosterGroupsAllowed: ["friends", "courtiers"],
      });
      expect(form.getAttribute("type")).toBe("submit");

      const fields = Array.from(form.getElementsByTagName("field"));
      expect(fields.map((field) => field.getAttribute("var"))).toEqual([
        "FORM_TYPE",
        "pubsub#access_model",
        "pubsub#roster_groups_allowed",
      ]);
      expect(fields[0].getElementsByTagName("value")[0].textContent).toBe(
        Pubsub.FORM_TYPE.NODE_CONFIG,
      );
      expect(
        Array.from(fields[2].getElementsByTagName("value")).map((value) => value.textContent),
      ).toEqual(["friends", "courtiers"]);
    });
  });

  describe("createRetractIq", () => {
    it("Example 115：撤回指定 ItemID", () => {
      const iq = Pubsub.createRetractIq(
        "princely_musings",
        "ae890ac52d0df67ed7cfdf51b644e901",
        true,
      );
      expect(iq.getAttribute("type")).toBe("set");
      const retractEl = iq.getElementsByTagName("pubsub")[0].getElementsByTagName("retract")[0];
      expect(retractEl.getAttribute("node")).toBe("princely_musings");
      expect(retractEl.getAttribute("notify")).toBe("true");
      expect(retractEl.getElementsByTagName("item")[0].getAttribute("id")).toBe(
        "ae890ac52d0df67ed7cfdf51b644e901",
      );
    });

    it("notify 为 false 时写出 notify='false'", () => {
      const iq = Pubsub.createRetractIq("n", "i", false);
      expect(iq.getElementsByTagName("retract")[0].getAttribute("notify")).toBe("false");
    });
  });

  /** 构造 `jabber:x:data` 的 `<x/>`；FORM_TYPE 由各用例给出 */
  const formEl = (type: "submit" | "form" | "result" | "cancel", formType?: string) =>
    Parser.parse(
      `<x xmlns="jabber:x:data" type="${type}">${
        formType
          ? `<field var="FORM_TYPE" type="hidden"><value>${formType}</value></field>`
          : ""
      }</x>`,
    );

  /** 断言 iq 的类型与 pubsub 子元素的命名空间 */
  const expectPubsub = (iq: XMPPElement, type: "get" | "set", ns: string) => {
    expect(iq.getAttribute("type")).toBe(type);
    const pubsubEl = iq.getElementsByTagName("pubsub")[0];
    expect(pubsubEl.namespaceURI).toBe(ns);
    return pubsubEl;
  };

  describe("订阅列表与权限检索（§5.6 / §5.7）", () => {
    it("Example 16：检索全部订阅，`<subscriptions/>` 无属性", () => {
      const iq = Pubsub.createRetrieveSubscriptionsIq("pubsub.shakespeare.lit");
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.BASE);
      const el = pubsubEl.getElementsByTagName("subscriptions")[0];
      expect(el.getAttribute("node")).toBeNull();
    });

    it("Example 20：检索指定节点的订阅", () => {
      const iq = Pubsub.createRetrieveSubscriptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
      );
      expect(
        iq.getElementsByTagName("subscriptions")[0].getAttribute("node"),
      ).toBe("princely_musings");
    });

    it("Example 22：检索全部权限，`<affiliations/>` 无属性", () => {
      const iq = Pubsub.createRetrieveAffiliationsIq("pubsub.shakespeare.lit");
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.BASE);
      expect(
        pubsubEl.getElementsByTagName("affiliations")[0].getAttribute("node"),
      ).toBeNull();
    });

    it("Example 26：检索指定节点的权限", () => {
      const iq = Pubsub.createRetrieveAffiliationsIq("pubsub.shakespeare.lit", "node6");
      expect(iq.getElementsByTagName("affiliations")[0].getAttribute("node")).toBe("node6");
    });
  });

  describe("订阅与退订（§6.1 / §6.2）", () => {
    it("Example 28：订阅请求带 node 与 jid", () => {
      const iq = Pubsub.createSubscribeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
      );
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.BASE);
      const el = pubsubEl.getElementsByTagName("subscribe")[0];
      expect(el.getAttribute("node")).toBe("princely_musings");
      expect(el.getAttribute("jid")).toBe("francisco@denmark.lit");
    });

    it("Example 67：订阅与提交选项同处一条 IQ，`<options/>` 不带任何属性", () => {
      const iq = Pubsub.createSubscribeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
        formEl("submit", "http://jabber.org/protocol/pubsub#subscribe_options"),
      );
      const optionsEl = iq.getElementsByTagName("options")[0];
      expect(optionsEl.getAttribute("node")).toBeNull();
      expect(optionsEl.getAttribute("jid")).toBeNull();
      expect(optionsEl.getElementsByTagName("x")[0].getAttribute("type")).toBe("submit");
    });

    it("Example 47：退订请求带 node 与 jid", () => {
      const iq = Pubsub.createUnsubscribeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
      );
      const el = iq.getElementsByTagName("unsubscribe")[0];
      expect(el.getAttribute("node")).toBe("princely_musings");
      expect(el.getAttribute("jid")).toBe("francisco@denmark.lit");
      expect(el.getAttribute("subid")).toBeNull();
    });

    it("§6.2.3.1：多订阅时补上 subid", () => {
      const iq = Pubsub.createUnsubscribeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
        "123-abc",
      );
      expect(iq.getElementsByTagName("unsubscribe")[0].getAttribute("subid")).toBe("123-abc");
    });
  });

  describe("订阅选项（§6.3 / §6.4）", () => {
    it("Example 55：检索订阅选项，`<options/>` 带 node 与 jid", () => {
      const iq = Pubsub.createRetrieveSubscriptionOptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
      );
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.BASE);
      const el = pubsubEl.getElementsByTagName("options")[0];
      expect(el.getAttribute("node")).toBe("princely_musings");
      expect(el.getAttribute("jid")).toBe("francisco@denmark.lit");
      expect(el.getElementsByTagName("x")).toHaveLength(0);
    });

    it("§6.3.4.4：请求选项时携带 subid", () => {
      const iq = Pubsub.createRetrieveSubscriptionOptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
        "123-abc",
      );
      expect(iq.getElementsByTagName("options")[0].getAttribute("subid")).toBe("123-abc");
    });

    it("Example 64：提交订阅选项表单", () => {
      const iq = Pubsub.createSubmitSubscriptionOptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "francisco@denmark.lit",
        formEl("submit", "http://jabber.org/protocol/pubsub#subscribe_options"),
      );
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.BASE);
      expect(
        pubsubEl.getElementsByTagName("options")[0].getElementsByTagName("x")[0].getAttribute(
          "type",
        ),
      ).toBe("submit");
    });

    it("Example 69：请求节点默认订阅选项（带 node，BASE 命名空间）", () => {
      const iq = Pubsub.createDefaultSubscriptionOptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
      );
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.BASE);
      expect(pubsubEl.getElementsByTagName("default")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 70：请求服务级默认订阅选项（`<default/>` 无属性）", () => {
      const iq = Pubsub.createDefaultSubscriptionOptionsIq("pubsub.shakespeare.lit");
      expect(iq.getElementsByTagName("default")[0].getAttribute("node")).toBeNull();
    });
  });

  describe("创建与配置节点（§8.1 / §8.2 / §8.3）", () => {
    it("Example 133：创建节点，`<create/>` 只带 node", () => {
      const iq = Pubsub.createNodeIq("pubsub.shakespeare.lit", "princely_musings");
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.BASE);
      expect(pubsubEl.getElementsByTagName("create")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
      expect(pubsubEl.getElementsByTagName("configure")).toHaveLength(0);
    });

    it("Example 131：请求即时节点，`<create/>` 无属性", () => {
      const iq = Pubsub.createNodeIq("pubsub.shakespeare.lit");
      expect(iq.getElementsByTagName("create")[0].getAttribute("node")).toBeNull();
    });

    it("Example 137：创建并配置，表单挂在 `<configure/>` 下（无 node 属性）", () => {
      const iq = Pubsub.createNodeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        formEl("submit", "http://jabber.org/protocol/pubsub#node_config"),
      );
      const configureEl = iq.getElementsByTagName("configure")[0];
      expect(configureEl.getAttribute("node")).toBeNull();
      expect(configureEl.getElementsByTagName("x")[0].getAttribute("type")).toBe("submit");
    });

    it("Example 139：检索节点配置表单（OWNER 命名空间的 get）", () => {
      const iq = Pubsub.createRetrieveNodeConfigIq("pubsub.shakespeare.lit", "princely_musings");
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("configure")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 146：提交节点配置表单，`<configure/>` 带 node", () => {
      const iq = Pubsub.createConfigureNodeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        formEl("submit", "http://jabber.org/protocol/pubsub#node_config"),
      );
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.OWNER);
      const configureEl = pubsubEl.getElementsByTagName("configure")[0];
      expect(configureEl.getAttribute("node")).toBe("princely_musings");
      expect(configureEl.getElementsByTagName("x")).toHaveLength(1);
    });

    it("Example 147：放弃配置，表单 type='cancel' 同样可提交", () => {
      const iq = Pubsub.createConfigureNodeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        formEl("cancel"),
      );
      expect(iq.getElementsByTagName("x")[0].getAttribute("type")).toBe("cancel");
    });

    it("Example 152：请求默认节点配置，`<default/>` 无属性", () => {
      const iq = Pubsub.createDefaultNodeConfigIq("pubsub.shakespeare.lit");
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("default")[0].getAttribute("type")).toBeNull();
    });

    it("Example 153：按节点类型请求默认配置（type='collection'）", () => {
      const iq = Pubsub.createDefaultNodeConfigIq("pubsub.shakespeare.lit", "collection");
      expect(iq.getElementsByTagName("default")[0].getAttribute("type")).toBe("collection");
    });
  });

  describe("删除与清空节点（§8.4 / §8.5）", () => {
    it("Example 157：删除节点，`<delete/>` 只带 node", () => {
      const iq = Pubsub.createDeleteNodeIq("pubsub.shakespeare.lit", "princely_musings");
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("delete")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 158：删除并重定向", () => {
      const iq = Pubsub.createDeleteNodeIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
        "xmpp:hamlet@denmark.lit?;node=blog",
      );
      expect(iq.getElementsByTagName("redirect")[0].getAttribute("uri")).toBe(
        "xmpp:hamlet@denmark.lit?;node=blog",
      );
    });

    it("Example 163：清空节点", () => {
      const iq = Pubsub.createPurgeNodeIq("pubsub.shakespeare.lit", "princely_musings");
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("purge")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });
  });

  describe("管理订阅与权限（§8.8 / §8.9）", () => {
    it("Example 184：检索节点订阅列表", () => {
      const iq = Pubsub.createRetrieveNodeSubscriptionsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
      );
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("subscriptions")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 189：只提交增量，未给出 subscription 的条目不改动", () => {
      const iq = Pubsub.createModifyNodeSubscriptionsIq("pubsub.shakespeare.lit", "princely_musings", [
        { jid: "bard@shakespeare.lit", subscription: "subscribed" },
      ]);
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.OWNER);
      const el = pubsubEl.getElementsByTagName("subscription")[0];
      expect(el.getAttribute("jid")).toBe("bard@shakespeare.lit");
      expect(el.getAttribute("subscription")).toBe("subscribed");
      expect(el.getAttribute("subid")).toBeNull();
    });

    it("Example 194：一次修改多条订阅（含 subid）", () => {
      const iq = Pubsub.createModifyNodeSubscriptionsIq("pubsub.shakespeare.lit", "princely_musings", [
        { jid: "polonius@denmark.lit", subscription: "none" },
        { jid: "bernardo@denmark.lit", subscription: "subscribed", subid: "004-yyy" },
      ]);
      const els = iq.getElementsByTagName("subscription");
      expect(els).toHaveLength(2);
      expect(els[0].getAttribute("subscription")).toBe("none");
      expect(els[1].getAttribute("subid")).toBe("004-yyy");
    });

    it("Example 197：检索节点权限列表", () => {
      const iq = Pubsub.createRetrieveNodeAffiliationsIq(
        "pubsub.shakespeare.lit",
        "princely_musings",
      );
      const pubsubEl = expectPubsub(iq, "get", Pubsub.NS.OWNER);
      expect(pubsubEl.getElementsByTagName("affiliations")[0].getAttribute("node")).toBe(
        "princely_musings",
      );
    });

    it("Example 202：修改权限（只提交增量）", () => {
      const iq = Pubsub.createModifyNodeAffiliationsIq("pubsub.shakespeare.lit", "princely_musings", [
        { jid: "bard@shakespeare.lit", affiliation: "publisher" },
      ]);
      const pubsubEl = expectPubsub(iq, "set", Pubsub.NS.OWNER);
      const el = pubsubEl.getElementsByTagName("affiliation")[0];
      expect(el.getAttribute("jid")).toBe("bard@shakespeare.lit");
      expect(el.getAttribute("affiliation")).toBe("publisher");
    });

    it("§8.9.3：affiliation='none' 即移除该实体", () => {
      const iq = Pubsub.createModifyNodeAffiliationsIq("pubsub.shakespeare.lit", "princely_musings", [
        { jid: "polonius@denmark.lit", affiliation: "none" },
      ]);
      expect(iq.getElementsByTagName("affiliation")[0].getAttribute("affiliation")).toBe("none");
    });
  });
});
