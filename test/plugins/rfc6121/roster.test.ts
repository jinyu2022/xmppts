import { describe, it, expect, vi } from "vitest";
import RFC6121 from "../../../lib/plugins/rfc6121";
import { Connection } from "../../../lib/connection";
import { JID } from "../../../lib/JID";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import type { Iq } from "../../../lib/stanza";
import { Pipeline } from "../../../lib/transport/pipeline";
import { Status, type TransportSink, type TransportSocket } from "../../../lib/transport/typing";
import type { TransportPipelineEvents } from "../../../lib/transport/stream-connection";
import type { Options } from "../../../lib/types";

/**
 * RFC 6121: XMPP Instant Messaging and Presence — Roster
 * @see https://datatracker.ietf.org/doc/html/rfc6121
 *
 * 用例取自 §2.2（登录后获取名册的 roster result）、§3.1.2（带 ask='subscribe' 的 push）、
 * §3.4.2（带 approved='true' 的 push）；
 * 另覆盖 §2.1.2.5/§2.1.2.6 的字段解析、§2.1.6 的 push 来源校验、§2.3.3 的分组写入、§3.1.1 的订阅 presence。
 */

/** 假传输层：只实现 Connection 访问的字段与通知接收者 */
class FakeTransport {
  status: TransportSocket["status"] = Status.BINDED;
  host = "localhost";
  port = "5222";
  jid: JID = new JID("test@example.com/resource");
  streamFeatures = new Set<string>();
  pipeline = new Pipeline<TransportPipelineEvents>();
  readonly sent: Array<string | XMPPElement> = [];
  readonly connect = vi.fn(async () => {});
  readonly reconnect = vi.fn(async () => {});
  readonly disconnect = vi.fn();

  constructor(readonly sink: TransportSink) {}

  send(data: string | XMPPElement): void {
    this.sent.push(data);
  }
}

/** 建立已绑定的连接；插件初始化后如需会话的请求才能正常发送 */
function setup(options: Options = {}) {
  const connection = new Connection("test@example.com/resource", "test123", {
    protocol: "xmpp",
    host: "localhost",
    port: 5222,
    tls: false,
    ...options,
  });
  const transport = new FakeTransport(connection._createSink());
  connection.transport = transport;
  transport.sink.onBinded();
  return { connection, transport };
}
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
        groups: ["Friends"],
      });
      expect(roster[1]).toMatchObject({
        jid: "mercutio@example.com",
        name: "Mercutio",
        subscription: "from",
        groups: [],
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

    it("RFC 6120 §2.6：approved='1' 同样是真值", () => {
      const el = Parser.parse(`
        <query xmlns='jabber:iq:roster'>
          <item approved='1' jid='juliet@example.com' subscription='none'/>
        </query>`);
      expect(RFC6121.parseRosterEl(el).roster[0].approved).toBe(true);
    });

    it("§2.1.2.2：非 subscribe 的 ask 忽略", () => {
      const el = Parser.parse(`
        <query xmlns='jabber:iq:roster'>
          <item ask='bogus' jid='juliet@example.com' subscription='none'/>
        </query>`);
      expect(RFC6121.parseRosterEl(el).roster[0].ask).toBeUndefined();
    });

    it("§2.1.2.6：一个条目可含多个 group", () => {
      const el = Parser.parse(`
        <query xmlns='jabber:iq:roster'>
          <item jid='romeo@example.net' subscription='both'>
            <group>Friends</group>
            <group>Lovers</group>
          </item>
        </query>`);
      expect(RFC6121.parseRosterEl(el).roster[0].groups).toEqual([
        "Friends",
        "Lovers",
      ]);
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

    it("未定义的 subscription 取值忽略，按 none 处理（§2.1.2.5）", () => {
      const el = Parser.parse(
        `<query xmlns="jabber:iq:roster"><item jid="mercutio@example.com" subscription="bogus"/></query>`
      );
      expect(RFC6121.parseRosterEl(el).roster[0].subscription).toBe("none");
    });
  });

  describe("setRoster（§2.3.3）", () => {
    it("一次写入多个分组", async () => {
      const { connection } = setup();
      const plugin = new RFC6121(connection);
      const result = XMPPElement.createElement("iq", { type: "result" });
      const sendAsync = vi
        .spyOn(connection, "sendAsync")
        .mockResolvedValue(result);

      await plugin.setRoster("romeo@example.net", "Romeo", ["Friends", "Lovers"]);

      const sent = sendAsync.mock.calls[0][0];
      const item = sent.getElementsByTagName("item")[0];
      expect(item.getAttribute("name")).toBe("Romeo");
      expect(
        Array.from(
          item.getElementsByTagName("group"),
          (group) => group.textContent
        )
      ).toEqual(["Friends", "Lovers"]);
    });

    it("空分组名是客户端错误", async () => {
      const { connection, transport } = setup();
      const plugin = new RFC6121(connection);
      await expect(plugin.setRoster("romeo@example.net", void 0, "")).rejects.toThrow(
        "分组名不能为空"
      );
      expect(transport.sent).toHaveLength(0);
    });
  });

  describe("订阅 presence（§3.1.1）", () => {
    it("to 取 bare JID，支持 string 与 JID", () => {
      const { connection, transport } = setup();
      const plugin = new RFC6121(connection);

      plugin.requestSubscription("juliet@example.com/balcony");
      plugin.cancelSubscribe(new JID("juliet@example.com/balcony"));
      plugin.approveSubscription("juliet@example.com");
      plugin.removeSubscription("juliet@example.com");

      const presences = transport.sent as XMPPElement[];
      expect(presences.map((p) => p.getAttribute("to"))).toEqual(
        Array(4).fill("juliet@example.com")
      );
      expect(presences.map((p) => p.getAttribute("type"))).toEqual([
        "subscribe",
        "unsubscribe",
        "subscribed",
        "unsubscribed",
      ]);
    });
  });

  describe("roster push 来源校验（§2.1.6）", () => {
    /** 构造一条 roster push；from 为 undefined 时省略该属性 */
    const push = (from?: string) =>
      `<iq type="set" id="push1"${
        from === void 0 ? "" : ` from="${from}"`
      }><query xmlns="jabber:iq:roster"><item jid="friend@example.net" subscription="both"/></query></iq>`;

    it("只接受来自自身 bare JID 的 push，并回 result", () => {
      const { connection, transport } = setup();
      new RFC6121(connection).init();
      const updates: Iq[] = [];
      connection.on("roster:update", (iq) => updates.push(iq));
      const feed = (from?: string) =>
        transport.sink.onStanza(Parser.parse(push(from)));

      // from 缺失视为来自自身
      feed();
      expect(updates).toHaveLength(1);
      feed("test@example.com");
      expect(updates).toHaveLength(2);
      expect(transport.sent).toHaveLength(2);

      // 同账号其他 resource 与外部实体均不接受
      feed("test@example.com/other");
      feed("mallory@example.net");
      expect(updates).toHaveLength(2);
      expect(transport.sent).toHaveLength(2);
    });
  });
});
