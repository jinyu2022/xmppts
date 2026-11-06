import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0045 from "../../../lib/plugins/xep0045";
import { MUC } from "../../../lib/plugins/xep0045/muc";
import { XEP0004 } from "../../../lib/plugins/xep0004";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { Presence } from "../../../lib/stanza";
import { XMPPError } from "../../../lib/errors";
import { FakeConnection } from "../../helpers/fake-connection";

const ROOM = "coven@chat.shakespeare.lit";
const USER_NS = MUC.NS.USER;

/**
 * XEP-0045 插件入口单元测试：注入 FakeConnection，验证装配、presence 状态机与全部 API 方法。
 * 集成测试（Mock Socket）见 index.test.ts。
 *
 * @see https://xmpp.org/extensions/xep-0045.html 1.34.6 §7.2.2（self-presence）、§7.6（改名）、
 *      §7.14（离开）、§8.2（踢出）、§9.1（封禁）、§10.9（销毁）
 */
describe("XEP0045 插件入口", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0045(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  /** 构造带 muc#user 扩展的 Presence，模拟接收管线的转换结果 */
  function makePresence(connection: FakeConnection, xml: string) {
    const el = Parser.parse(xml);
    const presence = new Presence(el, connection as unknown as Connection);
    const x = el.getElementsByTagNameNS(USER_NS, "x")[0];
    if (x) Object.assign(presence, MUC.parsePresUser(x));
    return presence;
  }

  /** 模拟已加入房间，供需要 rooms 条目的 API 用例使用 */
  function joinedRoom(plugin: XEP0045) {
    plugin.rooms.set(ROOM, { nick: "crone1", occupants: new Map() });
  }

  /** 首次进入房间所需的 self-presence（§7.2.2）；离开相关通知需显式传 unavailable */
  function selfPresence(
    connection: FakeConnection,
    nick = "crone1",
    statuses = ["110"],
    type?: "unavailable",
  ) {
    return makePresence(
      connection,
      `<presence xmlns="jabber:client" from="${ROOM}/${nick}"${type ? ` type="${type}"` : ""}>
        <x xmlns="${USER_NS}">
          <item affiliation="owner" role="moderator"/>
          ${statuses.map((code) => `<status code="${code}"/>`).join("")}
        </x>
      </presence>`,
    );
  }

  it("继承 MUC、声明 XEP0030 依赖且初始无已加入房间", () => {
    const plugin = new XEP0045(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(MUC);
    expect(XEP0045.dependencies).toEqual(["XEP0030"]);
    expect(plugin.rooms.size).toBe(0);
  });

  it("init 宣告 MUC 特性并注册全部事件", () => {
    const { connection } = setup();

    expect(connection.features.has(MUC.NS.BASE)).toBe(true);
    expect(connection.stanzaPlugins.get(USER_NS)).toBe(MUC.parsePresUser);
    expect(connection.eventPlugins.map((e) => e.eventName).sort()).toEqual([
      "muc:ban",
      "muc:decline",
      "muc:destroy",
      "muc:groupchat",
      "muc:join",
      "muc:kick",
      "muc:leave",
      "muc:mediated-invite",
      "muc:subject",
      "muc:voice-request",
    ]);
  });

  it("muc:groupchat 事件只匹配带 body 的群聊消息", () => {
    const { connection } = setup();
    const [matcher] = connection.matchersOf("muc:groupchat");

    expect(matcher({ type: "groupchat", body: "hi" })).toBe(true);
    expect(matcher({ type: "groupchat" })).toBe(false);
    expect(matcher({ type: "chat", body: "hi" })).toBe(false);
  });

  it("muc:kick/muc:ban 事件要求 unavailable 且携带对应状态码", () => {
    const { connection } = setup();

    expect(
      connection.matchersOf("muc:kick")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["307"] },
      }),
    ).toBe(true);
    expect(
      connection.matchersOf("muc:kick")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["301"] },
      }),
    ).toBe(false);
    expect(
      connection.matchersOf("muc:ban")[0]({
        type: "unavailable",
        muc: { item: {}, statuses: ["301"] },
      }),
    ).toBe(true);
  });

  describe("全局 presence 状态机", () => {
    it.fails("未加入房间时远端 presence 不创建房间条目（debug.md CORR-002，修复后移除 .fails）", () => {
      const { connection, plugin } = setup();

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/thirdwitch">
            <x xmlns="${USER_NS}"><item affiliation="none" role="participant"/></x>
          </presence>`,
        ),
      );

      // 没有本地加入请求时，不应把该房间标记为已加入
      expect(plugin.rooms.has(ROOM)).toBe(false);
    });

    it("已加入房间时记录其他住户的 available presence", () => {
      const { connection, plugin } = setup();
      // 未加入房间时不应由远端 presence 创建房间（debug.md CORR-002），故先置入房间条目
      plugin.rooms.set(ROOM, { nick: "crone1", occupants: new Map() });

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/thirdwitch">
            <x xmlns="${USER_NS}"><item affiliation="none" role="participant"/></x>
          </presence>`,
        ),
      );

      expect(plugin.rooms.get(ROOM)?.occupants.get(`${ROOM}/thirdwitch`)).toMatchObject({
        nick: "thirdwitch",
        role: "participant",
      });
    });

    it("收到自身 available 时更新房间昵称", () => {
      const { connection, plugin } = setup();
      plugin.rooms.set(ROOM, { nick: "old", occupants: new Map() });

      connection.emit("presence", selfPresence(connection, "new"));

      expect(plugin.rooms.get(ROOM)?.nick).toBe("new");
    });

    it("自身 unavailable + 303 只移除旧昵称，保留房间", () => {
      const { connection, plugin } = setup();
      plugin.rooms.set(ROOM, { nick: "crone1", occupants: new Map() });
      plugin.rooms.get(ROOM)!.occupants.set(`${ROOM}/crone1`, {
        nick: "crone1",
      });

      connection.emit(
        "presence",
        selfPresence(connection, "crone1", ["110", "303"], "unavailable"),
      );

      expect(plugin.rooms.has(ROOM)).toBe(true);
      expect(plugin.rooms.get(ROOM)!.occupants.has(`${ROOM}/crone1`)).toBe(false);
    });

    it("自身 unavailable 无 303 时删除整个房间", () => {
      const { connection, plugin } = setup();
      plugin.rooms.set(ROOM, { nick: "crone1", occupants: new Map() });

      connection.emit(
        "presence",
        selfPresence(connection, "crone1", ["110"], "unavailable"),
      );

      expect(plugin.rooms.has(ROOM)).toBe(false);
    });

    it("房间销毁时清理房间条目", () => {
      const { connection, plugin } = setup();
      plugin.rooms.set(ROOM, { nick: "crone1", occupants: new Map() });

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/crone1" type="unavailable">
            <x xmlns="${USER_NS}">
              <item affiliation="none" role="none"/>
              <destroy jid="capulet.lit"><reason>going away</reason></destroy>
            </x>
          </presence>`,
        ),
      );

      expect(plugin.rooms.has(ROOM)).toBe(false);
    });

    it("type=error 与无 muc item 的 presence 被忽略", () => {
      const { connection, plugin } = setup();

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/crone1" type="error">
            <error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
          </presence>`,
        ),
      );
      connection.emit("presence", makePresence(connection, `<presence xmlns="jabber:client" from="${ROOM}/crone1"/>`));

      expect(plugin.rooms.size).toBe(0);
    });
  });

  describe("join()", () => {
    it("收到 self-presence 后 resolve 并记录密码", async () => {
      const { connection, plugin } = setup();
      const pending = plugin.join(ROOM, "crone1", { password: "secret" });

      expect(connection.sent).toHaveLength(1);
      expect(connection.sent[0].getAttribute("to")).toBe(`${ROOM}/crone1`);

      connection.emit("presence", selfPresence(connection, "crone1"));
      await expect(pending).resolves.toBeDefined();
      expect(plugin.rooms.get(ROOM)?.password).toBe("secret");
      expect(plugin.rooms.get(ROOM)?.nick).toBe("crone1");
    });

    it("加入过程中收到其他住户 presence 不阻塞 110 兑现", async () => {
      const { connection, plugin } = setup();
      const pending = plugin.join(ROOM, "crone1");

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/thirdwitch">
            <x xmlns="${USER_NS}"><item affiliation="none" role="participant"/></x>
          </presence>`,
        ),
      );
      connection.emit("presence", selfPresence(connection, "crone1"));

      await expect(pending).resolves.toBeDefined();
      // 房间条目由 join() 自己建立，nick 取本次请求的昵称
      expect(plugin.rooms.get(ROOM)?.nick).toBe("crone1");
      expect(plugin.rooms.get(ROOM)?.occupants.has(`${ROOM}/thirdwitch`)).toBe(true);
    });

    it.fails("unavailable 的 110 presence 不判定加入成功（debug.md CORR-001，修复后移除 .fails）", async () => {
      const { connection, plugin } = setup();
      const pending = plugin.join(ROOM, "crone1").catch(() => undefined);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      // §7.2：unavailable 表示离开或失败，不能作为加入完成的信号
      connection.emit(
        "presence",
        selfPresence(connection, "crone1", ["110"], "unavailable"),
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(settled).toBe(false);
    });

    it("error presence 时 reject XMPPError 并清理房间", async () => {
      const { connection, plugin } = setup();
      const pending = plugin.join(ROOM, "crone1");

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/crone1" type="error">
            <error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
          </presence>`,
        ),
      );

      await expect(pending).rejects.toBeInstanceOf(XMPPError);
      expect(plugin.rooms.has(ROOM)).toBe(false);
    });

    it("超时 reject TimeoutError 并清理房间", async () => {
      vi.useFakeTimers();
      const { plugin } = setup();
      const pending = plugin.join(ROOM, "crone1").catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(300_000);
      const error = await pending;

      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("TimeoutError");
      expect(plugin.rooms.has(ROOM)).toBe(false);
    });

    it("send 抛错时 reject 并解绑监听", async () => {
      const { connection, plugin } = setup();
      const baseline = connection.listenerCount("presence");
      connection.send = () => {
        throw new Error("socket closed");
      };

      await expect(plugin.join(ROOM, "crone1")).rejects.toThrow("socket closed");
      expect(connection.listenerCount("presence")).toBe(baseline);
    });
  });

  describe("leave()", () => {
    it("未加入时抛错", async () => {
      const { plugin } = setup();
      await expect(plugin.leave(ROOM)).rejects.toThrow(`未加入房间${ROOM}`);
    });

    it("收到自身 unavailable + 110 后 resolve", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      const pending = plugin.leave(ROOM, "bye");

      expect(connection.sent[0].getAttribute("type")).toBe("unavailable");
      connection.emit(
        "presence",
        selfPresence(connection, "crone1", ["110"], "unavailable"),
      );

      await expect(pending).resolves.toBeUndefined();
    });

    it("error presence 时 reject XMPPError", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      const pending = plugin.leave(ROOM);

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/crone1" type="error">
            <error type="cancel"><item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
          </presence>`,
        ),
      );

      await expect(pending).rejects.toBeInstanceOf(XMPPError);
    });

    it("超时 reject 并解绑监听", async () => {
      vi.useFakeTimers();
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      const baseline = connection.listenerCount("presence");
      const pending = plugin.leave(ROOM).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;

      expect((error as DOMException).name).toBe("TimeoutError");
      expect(connection.listenerCount("presence")).toBe(baseline);
    });

    it("send 抛错时 reject", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      connection.send = () => {
        throw new Error("socket closed");
      };

      await expect(plugin.leave(ROOM)).rejects.toThrow("socket closed");
    });
  });

  describe("setNick()", () => {
    it("未加入时抛错", () => {
      const { plugin } = setup();
      expect(() => plugin.setNick(ROOM, "new")).toThrow(`未加入房间${ROOM}`);
    });

    it("旧昵称 303 不提前兑现，新昵称 available + 110 后 resolve（§7.6）", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      plugin.rooms.get(ROOM)!.occupants.set(`${ROOM}/crone1`, {
        nick: "crone1",
      });
      const pending = plugin.setNick(ROOM, "new");
      let settled = false;
      void pending.then(
        () => { settled = true; },
        () => { settled = true; },
      );

      // 第一条：旧昵称 unavailable，带 110 与 303；此时新昵称尚未确认，不应完成
      connection.emit(
        "presence",
        selfPresence(connection, "crone1", ["110", "303"], "unavailable"),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      // 旧昵称的住户条目被移除，房间本身保留
      expect(plugin.rooms.has(ROOM)).toBe(true);
      expect(plugin.rooms.get(ROOM)!.occupants.has(`${ROOM}/crone1`)).toBe(false);

      // 第二条：新昵称的 available self-presence 才算完成
      connection.emit("presence", selfPresence(connection, "new"));
      await expect(pending).resolves.toBeDefined();
      expect(plugin.rooms.get(ROOM)?.nick).toBe("new");
    });

    it("回显同 id 的 error 时 reject XMPPError", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      const pending = plugin.setNick(ROOM, "new");
      const id = connection.sent[0].getAttribute("id")!;

      connection.emit(
        "presence",
        makePresence(
          connection,
          `<presence xmlns="jabber:client" from="${ROOM}/new" id="${id}" type="error">
            <error type="cancel"><conflict xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error>
          </presence>`,
        ),
      );

      await expect(pending).rejects.toBeInstanceOf(XMPPError);
    });

    it("超时 reject 并解绑监听", async () => {
      vi.useFakeTimers();
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      const baseline = connection.listenerCount("presence");
      const pending = plugin.setNick(ROOM, "new").catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;

      expect((error as DOMException).name).toBe("TimeoutError");
      expect(connection.listenerCount("presence")).toBe(baseline);
    });

    it("send 抛错时 reject", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);
      connection.send = () => {
        throw new Error("socket closed");
      };

      await expect(plugin.setNick(ROOM, "new")).rejects.toThrow("socket closed");
    });
  });

  describe("房间操作", () => {
    it("requestVoice：未加入抛错，加入后发送申请表单", () => {
      const { connection, plugin } = setup();
      expect(() => plugin.requestVoice(ROOM)).toThrow(`未加入房间${ROOM}`);

      joinedRoom(plugin);
      plugin.requestVoice(ROOM);

      expect(connection.sent).toHaveLength(1);
      expect(connection.sent[0].getAttribute("to")).toBe(ROOM);
      expect(
        connection.sent[0].getElementsByTagNameNS(XEP0004.NS, "x"),
      ).toHaveLength(1);
    });

    // debug.md CORR-006：§8.1 只要求把主题变更反射给其他 occupant，发送者收不到同 id 回包，
    // 真实环境会走 sendAsync 超时。此处只覆盖「收到同 id 回包」这一实现分支。
    it("setSubject：收到同 id 回包时成功，error 时抛错", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);

      connection.sendAsyncResult = Parser.parse(`<message type="groupchat"/>`);
      await expect(plugin.setSubject(ROOM, "topic")).resolves.toBeUndefined();
      expect(connection.sentAsync[0].getAttribute("to")).toBe(ROOM);

      connection.sendAsyncResult = Parser.parse(`<message type="error"/>`);
      await expect(plugin.setSubject(ROOM, "topic")).rejects.toBeInstanceOf(
        XMPPError,
      );
    });

    it("kick：result 成功，error 抛错", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);

      connection.sendAsyncResult = Parser.parse(`<iq type="result"/>`);
      await expect(plugin.kick(ROOM, "thirdwitch", "bye")).resolves.toBeUndefined();
      expect(
        connection.sentAsync[0].getElementsByTagNameNS(MUC.NS.ADMIN, "item")[0].getAttribute("role"),
      ).toBe("none");

      connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
      await expect(plugin.kick(ROOM, "thirdwitch")).rejects.toBeInstanceOf(
        XMPPError,
      );
    });

    it("ban：字符串 JID 归一为 bare，error 抛错", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);

      connection.sendAsyncResult = Parser.parse(`<iq type="result"/>`);
      await expect(
        plugin.ban(ROOM, "romeo@montague.lit/orchard", "bye"),
      ).resolves.toBeUndefined();
      expect(
        connection.sentAsync[0].getElementsByTagNameNS(MUC.NS.ADMIN, "item")[0].getAttribute("jid"),
      ).toBe("romeo@montague.lit");

      connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
      await expect(plugin.ban(ROOM, "romeo@montague.lit")).rejects.toBeInstanceOf(
        XMPPError,
      );
    });

    it("getRoomConfig：解析表单，error 抛错", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);

      connection.sendAsyncResult = Parser.parse(`
        <iq type="result">
          <query xmlns="${MUC.NS.OWNER}">
            <x xmlns="${XEP0004.NS}" type="form">
              <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#roomconfig</value></field>
              <field var="muc#roomconfig_roomname" type="text-single"><value>Old</value></field>
            </x>
          </query>
        </iq>`);
      const form = await plugin.getRoomConfig(ROOM);
      expect(form.fields.find((field) => field.var === "muc#roomconfig_roomname")?.values).toEqual([
        "Old",
      ]);

      connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
      await expect(plugin.getRoomConfig(ROOM)).rejects.toBeInstanceOf(XMPPError);
    });

    it("setRoomConfig：result 返回原始 stanza，error 抛错", async () => {
      const { connection, plugin } = setup();
      joinedRoom(plugin);

      connection.sendAsyncResult = Parser.parse(`<iq type="result"/>`);
      const form = {
        type: "submit" as const,
        fields: [{ var: "FORM_TYPE", type: "hidden" as const, values: ["x"] }],
      };
      const res = await plugin.setRoomConfig(ROOM, form);
      expect(res.getAttribute("type")).toBe("result");

      connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
      await expect(plugin.setRoomConfig(ROOM, form)).rejects.toBeInstanceOf(
        XMPPError,
      );
    });
  });

  describe("房间创建", () => {
    /** 服务端返回的可提交配置表单（§10.2） */
    const CONFIG_RESULT = `
      <iq type="result">
        <query xmlns="${MUC.NS.OWNER}">
          <x xmlns="${XEP0004.NS}" type="form">
            <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#roomconfig</value></field>
            <field var="muc#roomconfig_roomname" type="text-single">
              <value>Old</value>
              <option label="a"><value>x</value></option>
            </field>
            <field var="muc#roomconfig_membersonly" type="boolean"><value>0</value></field>
            <field var="muc#roomconfig_moderatedroom" type="boolean"><value>0</value></field>
            <field var="muc#roomconfig_publicroom" type="boolean"><value>1</value></field>
            <field var="muc#roomconfig_whois" type="list-single"><value>moderators</value></field>
            <field var="muc#roomconfig_other" type="text-single"><value>keep</value></field>
          </x>
        </query>
      </iq>`;

    function setupJoined() {
      const ctx = setup();
      joinedRoom(ctx.plugin);
      return ctx;
    }

    /** 取出提交的配置表单字段 */
    function submittedFields(connection: FakeConnection) {
      const iq = connection.sentAsync.at(-1)!;
      const x = iq.getElementsByTagNameNS(XEP0004.NS, "x")[0];
      return XEP0004.parseFormEl(x).form.fields;
    }

    it("createPrivateRoom：改写私有房间字段并提交", async () => {
      const { connection, plugin } = setupJoined();
      // 第一次 sendAsync 返回配置表单，第二次返回提交结果
      let call = 0;
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        call += 1;
        return Promise.resolve(
          call === 1 ? Parser.parse(CONFIG_RESULT) : Parser.parse(`<iq type="result"/>`),
        );
      };

      await plugin.createPrivateRoom(ROOM, "Private Room");

      const fields = submittedFields(connection);
      const valueOf = (name: string) => fields.find((field) => field.var === name)?.values;
      expect(valueOf("muc#roomconfig_roomname")).toEqual(["Private Room"]);
      expect(valueOf("muc#roomconfig_membersonly")).toEqual(["1"]);
      expect(valueOf("muc#roomconfig_moderatedroom")).toEqual(["1"]);
      expect(valueOf("muc#roomconfig_publicroom")).toEqual(["0"]);
      expect(valueOf("muc#roomconfig_whois")).toEqual(["anyone"]);
      expect(valueOf("muc#roomconfig_other")).toEqual(["keep"]);
      // options 在提交前被移除
      expect(fields.find((field) => field.var === "muc#roomconfig_roomname")?.options).toBeUndefined();
    });

    it("createPublicRoom：改写公开房间字段并提交", async () => {
      const { connection, plugin } = setupJoined();
      let call = 0;
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        call += 1;
        return Promise.resolve(
          call === 1 ? Parser.parse(CONFIG_RESULT) : Parser.parse(`<iq type="result"/>`),
        );
      };

      await plugin.createPublicRoom(ROOM, "Public Room");

      const fields = submittedFields(connection);
      const valueOf = (name: string) => fields.find((field) => field.var === name)?.values;
      expect(valueOf("muc#roomconfig_roomname")).toEqual(["Public Room"]);
      expect(valueOf("muc#roomconfig_publicroom")).toEqual(["1"]);
      expect(valueOf("muc#roomconfig_whois")).toEqual(["anyone"]);
    });

    it("创建失败与未知响应类型报错", async () => {
      const { connection, plugin } = setupJoined();
      let call = 0;
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        call += 1;
        return Promise.resolve(
          call === 1 ? Parser.parse(CONFIG_RESULT) : Parser.parse(`<iq type="error"/>`),
        );
      };
      // setRoomConfig 已在提交阶段抛错，创建流程直接透传该错误
      await expect(plugin.createPrivateRoom(ROOM, "x")).rejects.toBeInstanceOf(
        XMPPError,
      );

      call = 0;
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        call += 1;
        return Promise.resolve(
          call === 1 ? Parser.parse(CONFIG_RESULT) : Parser.parse(`<iq type="get"/>`),
        );
      };
      await expect(plugin.createPrivateRoom(ROOM, "x")).rejects.toThrow(
        "未知的stanza类型",
      );

      call = 0;
      connection.sendAsync = (stanza) => {
        connection.sentAsync.push(stanza);
        call += 1;
        return Promise.resolve(
          call === 1 ? Parser.parse(CONFIG_RESULT) : Parser.parse(`<iq type="get"/>`),
        );
      };
      await expect(plugin.createPublicRoom(ROOM, "x")).rejects.toThrow(
        "未知的stanza类型",
      );
    });
  });
});
