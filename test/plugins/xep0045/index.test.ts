import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { JID } from "../../../lib/JID";
import { XEP0045 } from "../../../lib/plugins/xep0045";
import { FakeConnection } from "../../helpers/fake-connection";
import {
  createTcpConnection,
  getServer,
  negotiate,
  serverRef,
  waitForReceived,
  type MockServer,
} from "../../helpers/mock-transport";

// 将 node:net / node:tls 替换为 Mock Socket，避免真实 TCP/TLS 连接
vi.mock("node:net", async () => {
  const { netMock } = await import("../../helpers/mock-transport");
  return netMock();
});
// TLSSocket 需保留真实导出（传输层用 instanceof 判断 TLS 就绪）
vi.mock("node:tls", async (importOriginal) => {
  const { tlsMock } = await import("../../helpers/mock-transport");
  return tlsMock(importOriginal);
});

const ROOM = "coven@chat.shakespeare.lit";
const USER_NS = "http://jabber.org/protocol/muc#user";

/** 已建立连接的引用，供 afterEach 统一断开 */
const active = new Set<Connection>();

/** 创建仅注册 XEP0045 的连接；XEP0030 在 connect() 时按依赖自动补齐 */
function createConnection(): Connection {
  const connection = createTcpConnection("crone1@shakespeare.lit/desktop");
  active.add(connection);
  connection.registerPlugin("XEP0045");
  return connection;
}

/** 完成「连接 → 认证 → 绑定 → 服务器特性发现」 */
async function connect() {
  const connection = createConnection();
  const sessionStart = new Promise<void>((resolve) =>
    connection.once("session:start", () => resolve()),
  );
  await connection.connect();
  const server = getServer();
  await negotiate(server, "crone1@shakespeare.lit/desktop");
  await sessionStart;

  // XEP0030 在 session:start 后查询服务器特性，应答后连接才可继续
  const disco = Parser.parse(
    await waitForReceived(server, "http://jabber.org/protocol/disco#info"),
  );
  server.send(`<iq xmlns="jabber:client" type="result" from="shakespeare.lit" id="${disco.getAttribute("id")}">
    <query xmlns="http://jabber.org/protocol/disco#info">
      <feature var="http://jabber.org/protocol/muc"/>
    </query>
  </iq>`);
  return { connection, server };
}

/** 服务端下发一个 presence */
function sendPresence(server: MockServer, xml: string) {
  server.send(`<presence xmlns="jabber:client" ${xml}</presence>`);
}

/** 以 self-presence（110）完成一次加入 */
async function joinRoom(connection: Connection, server: MockServer) {
  const pending = connection.XEP0045!.join(ROOM, "crone1");
  await waitForReceived(server, `${ROOM}/crone1`);
  sendPresence(
    server,
    `from="${ROOM}/crone1">
      <x xmlns="${USER_NS}">
        <item affiliation="owner" role="moderator"/>
        <status code="110"/>
      </x>`,
  );
  await expect(pending).resolves.toBeDefined();
}

/**
 * XEP-0045 集成测试：只注册 XEP0045，由连接层自动补齐 XEP0030，
 * 经 Mock Socket 完成真实流协商后再验证加入/离开与全部房间事件的派发。
 *
 * @see https://xmpp.org/extensions/xep-0045.html 1.34.6 §7.2.2（self-presence）、§7.4（群聊消息）、
 *      §7.6（改名）、§7.14（离开）、§8.2（踢出）、§9.1（封禁）、§10.9（销毁）
 */
describe("XEP0045 插件入口集成（Mock Socket，仅注册当前插件）", () => {
  beforeEach(() => {
    serverRef.current = null;
  });

  afterEach(() => {
    for (const connection of active) {
      connection.transport?.disconnect();
    }
    active.clear();
  });

  it("仅注册 XEP0045 时自动补齐 XEP0030 并按 §7.2.1 完成加入", async () => {
    const { connection, server } = await connect();

    expect(connection.XEP0045).toBeDefined();
    expect(connection.XEP0030).toBeDefined();
    expect(connection.XEP0030!.features.has("http://jabber.org/protocol/muc")).toBe(
      true,
    );

    // §7.2.1：服务端先广播其他住户 presence，最后才发本人的 self-presence
    const joined = new Promise<void>((resolve) =>
      connection.once("muc:join", () => resolve()),
    );
    const pending = connection.XEP0045!.join(ROOM, "crone1");
    await waitForReceived(server, `${ROOM}/crone1`);
    sendPresence(
      server,
      `from="${ROOM}/thirdwitch">
        <x xmlns="${USER_NS}"><item affiliation="none" role="participant"/></x>`,
    );
    await expect(joined).resolves.toBeUndefined();

    sendPresence(
      server,
      `from="${ROOM}/crone1">
        <x xmlns="${USER_NS}">
          <item affiliation="owner" role="moderator"/>
          <status code="110"/>
        </x>`,
    );
    await expect(pending).resolves.toBeDefined();
    expect(connection.XEP0045!.rooms.get(ROOM)?.nick).toBe("crone1");
  });

  it("房内消息派发 muc:groupchat / muc:subject / muc:voice-request / 邀请与拒绝", async () => {
    const { connection, server } = await connect();
    await joinRoom(connection, server);

    const groupchat = new Promise<unknown>((resolve) =>
      connection.once("muc:groupchat", resolve),
    );
    server.send(`<message xmlns="jabber:client" from="${ROOM}/thirdwitch" to="crone1@shakespeare.lit/desktop" type="groupchat">
      <body>Harpier cries: 'tis time, 'tis time.</body>
    </message>`);
    await expect(groupchat).resolves.toMatchObject({ type: "groupchat" });

    const subject = new Promise<unknown>((resolve) =>
      connection.once("muc:subject", resolve),
    );
    server.send(`<message xmlns="jabber:client" from="${ROOM}/crone1" to="crone1@shakespeare.lit/desktop" type="groupchat">
      <subject>Fire Burn and Cauldron Bubble</subject>
    </message>`);
    await expect(subject).resolves.toMatchObject({ type: "groupchat" });

    const voice = new Promise<unknown>((resolve) =>
      connection.once("muc:voice-request", resolve),
    );
    server.send(`<message xmlns="jabber:client" from="${ROOM}/thirdwitch" to="crone1@shakespeare.lit/desktop">
      <x xmlns="jabber:x:data" type="form">
        <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#request</value></field>
        <field var="muc#role" type="list-single"><value>participant</value></field>
      </x>
    </message>`);
    await expect(voice).resolves.toBeDefined();

    const invite = new Promise<unknown>((resolve) =>
      connection.once("muc:mediated-invite", resolve),
    );
    server.send(`<message xmlns="jabber:client" from="${ROOM}" to="crone1@shakespeare.lit/desktop">
      <x xmlns="${USER_NS}">
        <invite from="witches@shakespeare.lit"><reason>Join us</reason></invite>
      </x>
    </message>`);
    await expect(invite).resolves.toBeDefined();

    const decline = new Promise<unknown>((resolve) =>
      connection.once("muc:decline", resolve),
    );
    server.send(`<message xmlns="jabber:client" from="${ROOM}" to="crone1@shakespeare.lit/desktop">
      <x xmlns="${USER_NS}">
        <decline from="romeo@montague.lit"><reason>Busy</reason></decline>
      </x>
    </message>`);
    await expect(decline).resolves.toBeDefined();
  });

  it("离开房间派发 muc:leave", async () => {
    const { connection, server } = await connect();
    await joinRoom(connection, server);

    const leaveEvent = new Promise<void>((resolve) =>
      connection.once("muc:leave", () => resolve()),
    );
    const leaving = connection.XEP0045!.leave(ROOM, "goodbye");
    await waitForReceived(server, 'type="unavailable"');
    sendPresence(
      server,
      `from="${ROOM}/crone1" type="unavailable">
        <x xmlns="${USER_NS}">
          <item affiliation="owner" role="none"/>
          <status code="110"/>
        </x>`,
    );
    await expect(leaving).resolves.toBeUndefined();
    await expect(leaveEvent).resolves.toBeUndefined();
    expect(connection.XEP0045!.rooms.has(ROOM)).toBe(false);
  });

  it("踢出、封禁与销毁派发对应事件", async () => {
    const { connection, server } = await connect();
    await joinRoom(connection, server);

    const kicked = new Promise<unknown>((resolve) =>
      connection.once("muc:kick", resolve),
    );
    sendPresence(
      server,
      `from="${ROOM}/thirdwitch" type="unavailable">
        <x xmlns="${USER_NS}">
          <item affiliation="none" role="none"><actor nick="crone1"/><reason>bye</reason></item>
          <status code="307"/>
        </x>`,
    );
    await expect(kicked).resolves.toBeDefined();

    const banned = new Promise<unknown>((resolve) =>
      connection.once("muc:ban", resolve),
    );
    sendPresence(
      server,
      `from="${ROOM}/thirdwitch" type="unavailable">
        <x xmlns="${USER_NS}">
          <item affiliation="outcast" role="none"><actor nick="crone1"/></item>
          <status code="301"/>
        </x>`,
    );
    await expect(banned).resolves.toBeDefined();

    const destroy = new Promise<unknown>((resolve) =>
      connection.once("muc:destroy", resolve),
    );
    sendPresence(
      server,
      `from="${ROOM}/crone1" type="unavailable">
        <x xmlns="${USER_NS}">
          <item affiliation="owner" role="none"/>
          <destroy jid="shakespeare.lit"><reason>going away</reason></destroy>
          <status code="110"/>
        </x>`,
    );
    await expect(destroy).resolves.toBeDefined();
    expect(connection.XEP0045!.rooms.has(ROOM)).toBe(false);
  });

  describe("setNick", () => {
    const ROOM = "coven@chat.shakespeare.lit";

    /** 构造 handler 需要的 presence 形状（不经过转换层） */
    function presence(
      from: string,
      options: { type?: "unavailable"; statuses?: string[] } = {},
    ) {
      return {
        from: new JID(from),
        type: options.type,
        id: undefined,
        xml: Parser.parse("<presence/>"),
        muc: { item: undefined, statuses: options.statuses },
      };
    }

    function setupRoom() {
      const connection = new FakeConnection();
      const plugin = new XEP0045(connection as unknown as Connection);
      plugin.init();
      plugin.rooms.set(ROOM, { nick: "thirdwitch", occupants: new Map() });
      return { connection, plugin };
    }

    // §7.6 Example 50：改名先收到旧昵称的 unavailable（303 + 110），再收到新昵称的 available（110）
    it("旧昵称的 303 unavailable self-presence 不算成功", async () => {
      const { connection, plugin } = setupRoom();
      let settled = false;
      const pending = plugin.setNick(ROOM, "oldhag");
      pending.then(
        () => (settled = true),
        () => (settled = true),
      );

      connection.emit(
        "presence",
        presence(`${ROOM}/thirdwitch`, {
          type: "unavailable",
          statuses: ["303", "110"],
        }),
      );
      await Promise.resolve();
      expect(settled).toBe(false);

      connection.emit(
        "presence",
        presence(`${ROOM}/oldhag`, { statuses: ["110"] }),
      );
      const result = await pending;
      expect(result.from.full).toBe(`${ROOM}/oldhag`);
    });

    // §7.7：自身旧昵称上的状态更新也是 available + 110，但不是改名结果
    it("旧昵称上的 available presence 更新不 resolve", async () => {
      const { connection, plugin } = setupRoom();
      let settled = false;
      const pending = plugin.setNick(ROOM, "oldhag");
      pending.then(
        () => (settled = true),
        () => (settled = true),
      );

      connection.emit(
        "presence",
        presence(`${ROOM}/thirdwitch`, { statuses: ["110"] }),
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      pending.catch(() => undefined);
    });

    // §7.6 Example 51：服务端改写昵称时在发给本人的 presence 里带 210
    it("服务端改写昵称（210）同样视为成功", async () => {
      const { connection, plugin } = setupRoom();
      const pending = plugin.setNick(ROOM, "OldHag");
      connection.emit(
        "presence",
        presence(`${ROOM}/oldhag`, { statuses: ["110", "210"] }),
      );
      await expect(pending).resolves.toBeDefined();
    });
  });
});

