import { describe, it, expect } from "vitest";
import { PEP } from "../../../lib/plugins/xep0163/pep";
import { XMPPElement } from "../../../lib/ltx/Element";

/**
 * XEP-0163: Personal Eventing Protocol
 * @see https://xmpp.org/extensions/xep-0163.html
 * @version 1.2.2 (2022-02-16)
 *
 * 用例取自 §1.2/§3：Example 1（发布 tune 事件）测构造，Example 3/4 的节点作为补充。
 */
describe("PEP", () => {
  const TUNE_NS = "http://jabber.org/protocol/tune";

  describe("createRetrieveItemsIq", () => {
    it("生成检索 PEP 项目的 get IQ（无 max）", () => {
      const iq = PEP.createRetrieveItemsIq("juliet@capulet.lit", TUNE_NS);
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("juliet@capulet.lit");
      const items = iq.getElementsByTagName("items")[0];
      expect(items.getAttribute("node")).toBe(TUNE_NS);
      expect(items.getElementsByTagName("item")).toHaveLength(0);
    });

    it("指定 max 时输出 max_items", () => {
      const iq = PEP.createRetrieveItemsIq("juliet@capulet.lit", TUNE_NS, 1);
      expect(iq.getElementsByTagName("items")[0].getAttribute("max_items")).toBe("1");
    });

    it("按 ItemID 检索时每个 ItemID 各写一个空 item（§6.5.6 支持多项）", () => {
      const iq = PEP.createRetrieveItemsIq("juliet@capulet.lit", TUNE_NS, 1, [
        "tunefoo1",
        "tunefoo2",
      ]);
      const itemEls = iq.getElementsByTagName("items")[0].getElementsByTagName("item");
      expect(itemEls).toHaveLength(2);
      expect(itemEls[0].getAttribute("id")).toBe("tunefoo1");
      expect(itemEls[1].getAttribute("id")).toBe("tunefoo2");
    });
  });

  describe("createPublishIq", () => {
    it("Example 1：生成发布 tune 事件的 set IQ", () => {
      const publish = XMPPElement.createElement("publish", { node: TUNE_NS });
      const item = XMPPElement.createElement("item");
      const tune = XMPPElement.createElementNS(TUNE_NS, "tune");
      const artist = XMPPElement.createElement("artist");
      artist.textContent = "Gerald Finzi";
      tune.appendChild(artist);
      item.appendChild(tune);
      publish.appendChild(item);

      const iq = PEP.createPublishIq(publish);
      expect(iq.getAttribute("type")).toBe("set");
      expect(iq.getElementsByTagName("publish")).toHaveLength(1);
      expect(iq.getElementsByTagName("artist")[0].textContent).toBe("Gerald Finzi");
    });

    it("提供 options 时包含 publish-options（§5 推荐支持）", () => {
      const publish = XMPPElement.createElement("publish", { node: TUNE_NS });
      publish.appendChild(XMPPElement.createElement("item"));
      const options = XMPPElement.createElement("publish-options");
      const iq = PEP.createPublishIq(publish, options);
      expect(iq.getElementsByTagName("publish-options")).toHaveLength(1);
    });
  });

  describe("createRetractIq", () => {
    it.each([{ notify: undefined }, { notify: true }])(
      "生成撤回 PEP 项目的 set IQ（notify=$notify）",
      ({ notify }) => {
        const iq = PEP.createRetractIq(TUNE_NS, "tunefoo1", notify);
        expect(iq.getAttribute("type")).toBe("set");
        const retract = iq.getElementsByTagName("retract")[0];
        expect(retract.getAttribute("node")).toBe(TUNE_NS);
        expect(retract.getElementsByTagName("item")[0].getAttribute("id")).toBe("tunefoo1");
      },
    );
  });
});
