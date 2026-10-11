import { describe, it, expect } from "vitest";
import Ping from "../../../lib/plugins/xep0199/ping";
import { JID } from "../../../lib/JID";

/**
 * XEP-0199: XMPP Ping
 * @see https://xmpp.org/extensions/xep-0199.html
 * @version 2.0.1 (2019-03-26)
 *
 * 用例取自 §4 Use Cases：客户端发出的 ping 请求（Example 4/10）测构造，
 * 服务器返回的 pong（Example 2/11）测构造。
 */
describe("Ping", () => {
  describe("createSendPingIq", () => {
    it("Example 4：生成客户端对服务器的 GET ping", () => {
      const iq = Ping.createSendPingIq("capulet.lit");
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("capulet.lit");
      const pingEl = iq.getElementsByTagName("ping")[0];
      expect(pingEl.namespaceURI).toBe(Ping.NS);
      expect(pingEl.children).toHaveLength(0);
    });

    it("Example 10：生成客户端到客户端的 GET ping", () => {
      const iq = Ping.createSendPingIq("juliet@capulet.lit/chamber");
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("juliet@capulet.lit/chamber");
      expect(iq.getElementsByTagName("ping")).toHaveLength(1);
    });
  });

  describe("createPingResultIq", () => {
    it("Example 2：生成回显 from/to/id 的 RESULT pong", () => {
      const iq = Ping.createPingResultIq(
        "juliet@capulet.lit/balcony",
        "capulet.lit",
        "s2c1"
      );
      expect(iq.getAttribute("type")).toBe("result");
      expect(iq.getAttribute("from")).toBe("juliet@capulet.lit/balcony");
      expect(iq.getAttribute("to")).toBe("capulet.lit");
      expect(iq.getAttribute("id")).toBe("s2c1");
    });

    it("Example 11：JID 实例作为 from/to", () => {
      const iq = Ping.createPingResultIq(
        new JID("juliet@capulet.lit/chamber"),
        new JID("romeo@montague.lit/home"),
        "e2e1"
      );
      expect(iq.getAttribute("from")).toBe("juliet@capulet.lit/chamber");
      expect(iq.getAttribute("to")).toBe("romeo@montague.lit/home");
    });
  });
});
