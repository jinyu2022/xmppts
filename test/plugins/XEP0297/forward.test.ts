import { describe, it, expect } from "vitest";
import { Forward } from "../../../lib/plugins/XEP0297/forward";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0297: Stanza Forwarding
 * @see https://xmpp.org/extensions/xep-0297.html
 * @version 1.0 (2013-10-02)
 *
 * 用例取自 §3.1 Example 1（原始消息）与 Example 2（转发消息，含 delay 与 mood）。
 */
describe("Forward", () => {
  // §3.1 Example 2：外层转发消息中的 forwarded 负载
  const EXAMPLE_2_FORWARDED = `
    <forwarded xmlns='urn:xmpp:forward:0'>
      <delay xmlns='urn:xmpp:delay' stamp='2010-07-10T23:08:25Z'/>
      <message from='juliet@capulet.lit/orchard'
               id='0202197'
               to='romeo@montague.lit'
               type='chat'
               xmlns='jabber:client'>
        <body>Yet I should kill thee with much cherishing.</body>
      </message>
    </forwarded>`;

  /** 把返回值收窄为可访问各 stanza 的形状 */
  type ForwardedParts = {
    message?: XMPPElement;
    presence?: XMPPElement;
    iq?: XMPPElement;
    delay?: XMPPElement | null;
  };
  const parse = (el: XMPPElement) =>
    Forward.parseForwardedEl(el).forwarded as unknown as ForwardedParts;

  describe("parseForwardedEl", () => {
    it("Example 2：解析 forwarded 中的 delay 与 message", () => {
      const el = Parser.parse(EXAMPLE_2_FORWARDED);
      expect(el.namespaceURI).toBe(Forward.NS);
      const forwarded = parse(el);
      expect(forwarded.delay!.getAttribute("stamp")).toBe("2010-07-10T23:08:25Z");
      expect(forwarded.message!.getAttribute("from")).toBe("juliet@capulet.lit/orchard");
      expect(forwarded.message!.getAttribute("to")).toBe("romeo@montague.lit");
      expect(forwarded.message!.getAttribute("type")).toBe("chat");
      expect(forwarded.message!.getElementsByTagName("body")[0]?.textContent).toBe(
        "Yet I should kill thee with much cherishing."
      );
    });

    it("无 delay 时 delay 为空", () => {
      const forwarded = parse(
        Parser.parse(`
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="juliet@capulet.lit/orchard" type="chat" xmlns="jabber:client">
              <body>Hi</body>
            </message>
          </forwarded>`)
      );
      expect(forwarded.message).toBeDefined();
      expect(forwarded.delay).toBeUndefined();
    });

    // XEP-0297 §2：`<delay/>` 必须是 `<forwarded/>` 的直接子元素
    it("不把被转发 stanza 自己的 delay 当成转发延迟", () => {
      const forwarded = parse(
        Parser.parse(`
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="juliet@capulet.lit/orchard" type="chat" xmlns="jabber:client">
              <body>Hi</body>
              <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
            </message>
          </forwarded>`)
      );
      expect(forwarded.message).toBeDefined();
      expect(forwarded.delay).toBeUndefined();
    });

    it("§8 XML Schema：允许转发 presence", () => {
      const forwarded = parse(
        Parser.parse(`
          <forwarded xmlns="urn:xmpp:forward:0">
            <presence from="juliet@capulet.lit/balcony" xmlns="jabber:client">
              <show>away</show>
            </presence>
          </forwarded>`)
      );
      expect(forwarded.presence!.getAttribute("from")).toBe("juliet@capulet.lit/balcony");
    });

    it("§8 XML Schema：允许转发 iq", () => {
      const forwarded = parse(
        Parser.parse(`
          <forwarded xmlns="urn:xmpp:forward:0">
            <iq from="capulet.lit" to="romeo@montague.lit" type="result" id="iq-1" xmlns="jabber:client"/>
          </forwarded>`)
      );
      expect(forwarded.iq!.getAttribute("type")).toBe("result");
    });

    it("§8 XML Schema：含两个 stanza 时抛错", () => {
      const el = Parser.parse(`
        <forwarded xmlns="urn:xmpp:forward:0">
          <message from="juliet@capulet.lit/orchard" xmlns="jabber:client"/>
          <presence from="juliet@capulet.lit/balcony" xmlns="jabber:client"/>
        </forwarded>`);
      expect(() => Forward.parseForwardedEl(el)).toThrow(
        "forwarded包含多个message | presence | iq"
      );
    });

    it("forwarded 元素命名空间不符时抛错", () => {
      const el = Parser.parse(`<forwarded xmlns="urn:example:wrong"/>`);
      expect(() => Forward.parseForwardedEl(el)).toThrow(
        "不是一个 forwarded 元素"
      );
    });
  });
});
