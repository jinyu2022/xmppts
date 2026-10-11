import { describe, it, expect } from "vitest";
import { MUC, MUCStatusCode } from "../../../lib/plugins/xep0045/muc";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import { JID } from "../../../lib/JID";

/**
 * XEP-0045: Multi-User Chat
 * @see https://xmpp.org/extensions/xep-0045.html
 * @version 1.35.5 (2026-05-03)
 *
 * 用例取自 §4.3 场景（房间 coven@chat.shakespeare.lit，昵称 thirdwitch）：客户端发出的
 * presence/message/iq 用于构造（§7.2.1 Example 18、§7.2.5 Example 26、§7.14 Example 80、
 * §7.6 Example 49、§7.8.2 Example 56、§7.13 Example 79、§8.1 Example 84、§9.1 Example 110、
 * §9.3 Example 120、§8.2 Example 89、§10.1.3 Example 156）；服务器下发的 muc#user 扩展
 * 用于解析（§7.2.2 Example 21、§7.2.3 Example 23、§7.8.2 Example 57/59）。
 */
describe("MUC", () => {
  // §4.3：房间与昵称
  const ROOM = "coven@chat.shakespeare.lit";
  const NICK = "thirdwitch";
  const OCCUPANT = `${ROOM}/${NICK}`;

  describe("MUCStatusCode", () => {
    it("定义全部标准状态码（§16.6.2 Initial Submission）", () => {
      expect(MUCStatusCode.SelfPresence).toBe("110");
      expect(MUCStatusCode.Created).toBe("201");
      expect(MUCStatusCode.Banned).toBe("301");
      expect(MUCStatusCode.NewNick).toBe("303");
      expect(MUCStatusCode.Kicked).toBe("307");
    });
  });

  describe("ROLE 与 AFFILIATION", () => {
    it("按顺序定义 role（§5.1 Roles）", () => {
      expect(MUC.ROLE).toEqual(["none", "visitor", "participant", "moderator"]);
    });

    it("按顺序定义 affiliation（§5.2 Affiliations）", () => {
      expect(MUC.AFFILIATION).toEqual([
        "none",
        "outcast",
        "member",
        "admin",
        "owner",
      ]);
    });
  });

  describe("createJoinPres", () => {
    it("Example 18：生成加入房间的 presence", () => {
      const pres = MUC.createJoinPres(ROOM, NICK);
      expect(pres.getAttribute("to")).toBe(OCCUPANT);
      expect(pres.tagName).toBe("presence");
      expect(pres.getAttribute("type")).toBeNull();
      const xEl = pres.getElementsByTagNameNS(MUC.NS.BASE, "x")[0];
      expect(xEl).toBeDefined();
    });

    it("Example 26：指定时包含 password", () => {
      const pres = MUC.createJoinPres(ROOM, NICK, { password: "cauldronburn" });
      const xEl = pres.getElementsByTagNameNS(MUC.NS.BASE, "x")[0];
      const passwordEl = xEl.getElementsByTagName("password")[0];
      expect(passwordEl).toBeDefined();
      expect(passwordEl.textContent).toBe("cauldronburn");
    });

    it("只指定 password 时不生成 <history/>（§7.2.14）", () => {
      const pres = MUC.createJoinPres(ROOM, NICK, { password: "cauldronburn" });
      const xEl = pres.getElementsByTagNameNS(MUC.NS.BASE, "x")[0];
      expect(xEl.getElementsByTagName("history")[0]).toBeUndefined();
    });

    it("Example 35–38：包含 history 选项", () => {
      const pres = MUC.createJoinPres(ROOM, NICK, {
        maxchars: 65000,
        maxstanzas: 20,
        seconds: 180,
        since: new Date("1970-01-01T00:00:00Z"),
      });
      const xEl = pres.getElementsByTagNameNS(MUC.NS.BASE, "x")[0];
      const history = xEl.getElementsByTagName("history")[0];
      expect(history).toBeDefined();
      expect(history.getAttribute("maxchars")).toBe("65000");
      expect(history.getAttribute("maxstanzas")).toBe("20");
      expect(history.getAttribute("seconds")).toBe("180");
      expect(history.getAttribute("since")).toBe("1970-01-01T00:00:00.000Z");
    });

    it("接受 JID 实例作为房间", () => {
      const pres = MUC.createJoinPres(new JID(ROOM), NICK);
      expect(pres.getAttribute("to")).toBe(OCCUPANT);
    });
  });

  describe("createLeavePres", () => {
    it("Example 80/83：生成带原因的 unavailable presence", () => {
      const pres = MUC.createLeavePres(OCCUPANT, "gone where the goblins go");
      expect(pres.getAttribute("type")).toBe("unavailable");
      expect(pres.getAttribute("to")).toBe(OCCUPANT);
      expect(pres.getElementsByTagName("status")[0].textContent).toBe(
        "gone where the goblins go",
      );
    });

    it("生成不带原因的 unavailable presence", () => {
      const pres = MUC.createLeavePres(OCCUPANT);
      expect(pres.getAttribute("type")).toBe("unavailable");
      expect(pres.getElementsByTagName("status")).toHaveLength(0);
    });
  });

  describe("createSetNickPres", () => {
    it("Example 49：生成修改昵称的 presence", () => {
      const pres = MUC.createSetNickPres(ROOM, "oldhag");
      expect(pres.getAttribute("to")).toBe(`${ROOM}/oldhag`);
      expect(pres.getAttribute("id")).toBeTruthy();
    });
  });

  describe("createMediatedInvite", () => {
    it("Example 56：生成中介邀请消息", () => {
      const msg = MUC.createMediatedInvite(
        ROOM,
        "hecate@shakespeare.lit",
        "Hey Hecate, this is the place for all good witches!",
      );
      expect(msg.tagName).toBe("message");
      expect(msg.getAttribute("to")).toBe(ROOM);
      const xEl = msg.getElementsByTagNameNS(MUC.NS.USER, "x")[0];
      const invite = xEl.getElementsByTagName("invite")[0];
      expect(invite.getAttribute("to")).toBe("hecate@shakespeare.lit");
      expect(invite.getElementsByTagName("reason")[0].textContent).toBe(
        "Hey Hecate, this is the place for all good witches!",
      );
    });
  });

  describe("createRequestVoiceMsg", () => {
    it("Example 79：生成带 data form 的申请发言消息", () => {
      const msg = MUC.createRequestVoiceMsg(ROOM);
      expect(msg.tagName).toBe("message");
      expect(msg.getAttribute("to")).toBe(ROOM);
      const xEl = msg.getElementsByTagNameNS("jabber:x:data", "x")[0];
      expect(xEl).toBeDefined();
    });
  });

  describe("createSetSubjectMsg", () => {
    it("Example 84：生成带 subject 的 groupchat 消息", () => {
      const msg = MUC.createSetSubjectMsg(ROOM, "Fire Burn and Cauldron Bubble!");
      expect(msg.tagName).toBe("message");
      expect(msg.getAttribute("to")).toBe(ROOM);
      expect(msg.getAttribute("type")).toBe("groupchat");
      expect(msg.getElementsByTagName("subject")[0].textContent).toBe(
        "Fire Burn and Cauldron Bubble!",
      );
    });
  });

  describe("createSetAffiliationIq", () => {
    it("Example 120：生成设置 member affiliation 的 IQ", () => {
      const iq = MUC.createSetAffiliationIq(ROOM, "hag66@shakespeare.lit", "member");
      expect(iq.getAttribute("type")).toBe("set");
      expect(iq.getAttribute("to")).toBe(ROOM);
      const query = iq.getElementsByTagNameNS(MUC.NS.ADMIN, "query")[0];
      const item = query.getElementsByTagName("item")[0];
      expect(item.getAttribute("jid")).toBe("hag66@shakespeare.lit");
      expect(item.getAttribute("affiliation")).toBe("member");
    });

    it("Example 111：生成封禁用户的 IQ 并带 reason", () => {
      const iq = MUC.createSetAffiliationIq(
        ROOM,
        "earlofcambridge@shakespeare.lit",
        "outcast",
        "Treason",
      );
      const item = iq
        .getElementsByTagNameNS(MUC.NS.ADMIN, "query")[0]
        .getElementsByTagName("item")[0];
      expect(item.getAttribute("affiliation")).toBe("outcast");
      expect(item.getElementsByTagName("reason")[0].textContent).toBe("Treason");
    });
  });

  describe("createSetRoleIq", () => {
    it("Example 137：生成设置 moderator role 的 IQ", () => {
      const iq = MUC.createSetRoleIq(ROOM, NICK, "moderator");
      const item = iq
        .getElementsByTagNameNS(MUC.NS.ADMIN, "query")[0]
        .getElementsByTagName("item")[0];
      expect(item.getAttribute("nick")).toBe(NICK);
      expect(item.getAttribute("role")).toBe("moderator");
    });

    it("Example 89：生成带原因的 kick（role=none）IQ", () => {
      const iq = MUC.createSetRoleIq(ROOM, "pistol", "none", "Avaunt, you cullion!");
      const item = iq
        .getElementsByTagNameNS(MUC.NS.ADMIN, "query")[0]
        .getElementsByTagName("item")[0];
      expect(item.getAttribute("role")).toBe("none");
      expect(item.getElementsByTagName("reason")[0].textContent).toBe(
        "Avaunt, you cullion!",
      );
    });
  });

  describe("createGetRoomConfigIq", () => {
    it("Example 156：生成获取房间配置的 IQ", () => {
      const iq = MUC.createGetRoomConfigIq(ROOM);
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe(ROOM);
      expect(iq.getElementsByTagNameNS(MUC.NS.OWNER, "query")[0]).toBeDefined();
    });
  });

  describe("parsePresUser", () => {
    it("Example 21：解析自 presence 的 item 与 110 状态码", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" jid="hag66@shakespeare.lit/pda" role="participant"/>
          <status code="110"/>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      expect(muc.item).toEqual({
        affiliation: "member",
        role: "participant",
        jid: "hag66@shakespeare.lit/pda",
      });
      expect(muc.statuses).toContain("110");
    });

    it("Example 40：解析仅含 status 的配置通知", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <status code="170"/>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      expect(muc.item).toBeUndefined();
      expect(muc.statuses).toEqual(["170"]);
    });

    it("Example 59：解析 decline 元素", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <decline from="hecate@shakespeare.lit">
            <reason>Sorry, I'm too busy right now.</reason>
          </decline>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      if (!("decline" in muc)) {
        throw new Error("Expected a MUC decline payload");
      }
      expect(muc.decline).toEqual({
        to: undefined,
        from: "hecate@shakespeare.lit",
        reason: "Sorry, I'm too busy right now.",
      });
    });

    it("Example 57：解析中介邀请与 password", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <invite from="crone1@shakespeare.lit/desktop">
            <reason>Hey Hecate, this is the place for all good witches!</reason>
            <continue thread="e0ffe42b28561960c6b12b944a092794b9683a38"/>
          </invite>
          <password>cauldronburn</password>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      if (!("invites" in muc)) {
        throw new Error("Expected a MUC invitation payload");
      }
      expect(muc.invites).toEqual([
        {
          to: undefined,
          from: "crone1@shakespeare.lit/desktop",
          reason: "Hey Hecate, this is the place for all good witches!",
          thread: undefined,
          continue: { thread: "e0ffe42b28561960c6b12b944a092794b9683a38" },
        },
      ]);
      expect(muc.password).toBe("cauldronburn");
    });

    it("非 x 标签时返回空对象", () => {
      const el = XMPPElement.createElement("message");
      expect(MUC.parsePresUser(el).muc).toEqual({});
    });

    it("仅带 role 的 item 仍被保留（§8.5 授权发言）", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item nick="thirdwitch" role="participant"/>
          <status code="110"/>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      expect(muc.item).toEqual({ nick: "thirdwitch", role: "participant" });
    });

    it("仅带 affiliation 的 item 仍被保留（§9.5 修改成员名录）", () => {
      const xml = Parser.parse(`
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" jid="hecate@shakespeare.lit/broom"/>
        </x>
      `);
      const { muc } = MUC.parsePresUser(xml);
      expect(muc.item?.affiliation).toBe("member");
      expect(muc.item?.role).toBeUndefined();
    });
  });

  describe("createGetReservedNickIq", () => {
    it("Example 77：生成 node 为 x-roomuser-item 的 disco#info 查询", () => {
      const iq = MUC.createGetReservedNickIq(ROOM);
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe(ROOM);
      const query = iq.getElementsByTagNameNS(
        "http://jabber.org/protocol/disco#info",
        "query",
      )[0];
      expect(query.getAttribute("node")).toBe("x-roomuser-item");
    });
  });
});
