import { describe, it, expect } from "vitest";
import RFC6121 from "../../../lib/plugins/rfc6121";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * RFC 6121: XMPP Instant Messaging and Presence — Roster
 * @see https://datatracker.ietf.org/doc/html/rfc6121
 *
 * 用例取自 §2.2（登录后获取名册的 roster result）、§3.1.2（带 ask='subscribe' 的 push）、
 * §3.4.2（带 approved='true' 的 push）。
 */
describe("RFC6121 Roster", () => {
  // §2.2：服务器返回的 roster result
  const ROSTER_RESULT = `
    <query xmlns='jabber:iq:roster' ver='ver11'>
      <item jid='romeo@example.net' name='Romeo' subscription='both'>
        <group>Friends</group>
      </item>
      <item jid='mercutio@example.com' name='Mercutio' subscription='from'/>
      <item jid='benvolio@example.net' name='Benvolio' subscription='both'/>
    </query>`;
  // §3.1.2：待批准的订阅（ask='subscribe'）
  const ROSTER_PUSH_ASK = `
    <query xmlns='jabber:iq:roster'>
      <item ask='subscribe' jid='juliet@example.com' subscription='none'/>
    </query>`;
  // §3.4.2：预批准订阅（approved='true'）
  const ROSTER_PUSH_APPROVED = `
    <query xmlns='jabber:iq:roster'>
      <item approved='true' jid='juliet@example.com' subscription='none'/>
    </query>`;

  describe("parseRosterEl", () => {
    it("§2.2：解析名册条目（含 name、subscription、group）", () => {
      const roster = RFC6121.parseRosterEl(Parser.parse(ROSTER_RESULT)).roster;
      expect(roster).toHaveLength(3);
      expect(roster[0]).toMatchObject({
        jid: "romeo@example.net",
        name: "Romeo",
        subscription: "both",
        approved: false,
      });
      expect(roster[1]).toMatchObject({
        jid: "mercutio@example.com",
        name: "Mercutio",
        subscription: "from",
      });
      expect(roster[2].jid).toBe("benvolio@example.net");
    });

    it("§3.1.2：解析 ask='subscribe'", () => {
      const item = RFC6121.parseRosterEl(Parser.parse(ROSTER_PUSH_ASK)).roster[0];
      expect(item.jid).toBe("juliet@example.com");
      expect(item.subscription).toBe("none");
      expect(item.ask).toBe("subscribe");
    });

    it("§3.4.2：解析 approved='true'", () => {
      const item = RFC6121.parseRosterEl(Parser.parse(ROSTER_PUSH_APPROVED)).roster[0];
      expect(item.approved).toBe(true);
    });

    it("§2.1.4：无条目时返回空数组", () => {
      const el = Parser.parse(`<query xmlns='jabber:iq:roster' ver='ver9'/>`);
      expect(RFC6121.parseRosterEl(el).roster).toHaveLength(0);
    });

    it("命名空间非法时抛错", () => {
      const el = Parser.parse(`<query xmlns='urn:invalid'/>`);
      expect(() => RFC6121.parseRosterEl(el)).toThrow("不是一个roster");
    });
  });

  describe("subscription 取值（§2.1.2.5）", () => {
    it.each(["none", "to", "from", "both", "remove"])(
      "解析 subscription=%s",
      (sub) => {
        const el = Parser.parse(
          `<query xmlns="jabber:iq:roster"><item jid="mercutio@example.com" subscription="${sub}"/></query>`
        );
        expect(RFC6121.parseRosterEl(el).roster[0].subscription).toBe(sub);
      },
    );

    it("subscription 缺失时默认 none（§2.1.2.5）", () => {
      const el = Parser.parse(
        `<query xmlns="jabber:iq:roster"><item jid="mercutio@example.com"/></query>`
      );
      expect(RFC6121.parseRosterEl(el).roster[0].subscription).toBe("none");
    });
  });
});
