import { describe, it, expect } from "vitest";
import { Carbons } from "../../../lib/plugins/xep0280/carbons";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0280: Message Carbons
 * @see https://xmpp.org/extensions/xep-0280.html
 * @version 1.0.1 (2021-12-26)
 *
 * 用例取自规范示例：客户端发出的 enable/disable（Example 3/6）测构造，
 * 服务器下发的 received/sent（Example 10/13）测解析；无示例分支按 §14 schema 补充。
 */
describe("Carbons", () => {
  /** Example 10：服务器把 Juliet 的来信作为 carbon 转发给 Romeo 的其它资源 */
  const EXAMPLE_10 = `
    <message xmlns="jabber:client" from="romeo@montague.example" to="romeo@montague.example/home" type="chat">
      <received xmlns="urn:xmpp:carbons:2">
        <forwarded xmlns="urn:xmpp:forward:0">
          <message xmlns="jabber:client" from="juliet@capulet.example/balcony" to="romeo@montague.example/garden" type="chat">
            <body>What man art thou that, thus bescreen'd in night, so stumblest on my counsel?</body>
            <thread>0e3141cd80894871a68e6fe6b1ec56fa</thread>
          </message>
        </forwarded>
      </received>
    </message>
  `;

  /** Example 13：Romeo 的其它资源收到自己发出消息的 carbon */
  const EXAMPLE_13 = `
    <message xmlns="jabber:client" from="romeo@montague.example" to="romeo@montague.example/garden" type="chat">
      <sent xmlns="urn:xmpp:carbons:2">
        <forwarded xmlns="urn:xmpp:forward:0">
          <message xmlns="jabber:client" to="juliet@capulet.example/balcony" from="romeo@montague.example/home" type="chat">
            <body>Neither, fair saint, if either thee dislike.</body>
            <thread>0e3141cd80894871a68e6fe6b1ec56fa</thread>
          </message>
        </forwarded>
      </sent>
    </message>
  `;

  describe("createEnableIq", () => {
    it("Example 3：生成带 enable 元素的 set IQ", () => {
      const iq = Carbons.createEnableIq();
      const enable = iq.getElementsByTagName("enable")[0];
      expect(iq.getAttribute("type")).toBe("set");
      expect(enable.namespaceURI).toBe(Carbons.NS);
      expect(enable.children).toHaveLength(0);
    });
  });

  describe("createDisableIq", () => {
    it("Example 6：生成带 disable 元素的 set IQ", () => {
      const iq = Carbons.createDisableIq();
      const disable = iq.getElementsByTagName("disable")[0];
      expect(iq.getAttribute("type")).toBe("set");
      expect(disable.namespaceURI).toBe(Carbons.NS);
      expect(disable.children).toHaveLength(0);
    });
  });

  describe("parseCarbonEl", () => {
    it("Example 10：解析 received carbon 及其 forwarded", () => {
      const result = Carbons.parseCarbonEl(Parser.parse(EXAMPLE_10));
      expect(result.carbon.type).toBe("received");
      expect(result.carbon.forwarded).toBeDefined();
      expect(result.carbon.forwarded.getElementsByTagName("message")).toHaveLength(1);
    });

    it("Example 13：解析 sent carbon 及其 forwarded", () => {
      const result = Carbons.parseCarbonEl(Parser.parse(EXAMPLE_13));
      expect(result.carbon.type).toBe("sent");
      expect(result.carbon.forwarded).toBeDefined();
    });

    it("未找到 carbon 元素时抛错", () => {
      const el = XMPPElement.createElement("message");
      expect(() => Carbons.parseCarbonEl(el)).toThrow("未找到 carbon 元素");
    });
  });
});
