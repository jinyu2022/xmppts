import { describe, it, expect } from "vitest";
import { VCardTemp } from "../../../lib/plugins/xep0054/vcardTemp";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0054: vcard-temp
 * @see https://xmpp.org/extensions/xep-0054.html
 * @version 1.3.0 (2024-06-27)
 *
 * 用例取自 §3 Use Cases 的规范示例：服务器下发的（Example 2 / 4 / 9）测解析，
 * 客户端发出的（Example 5）测构造；其余无示例的分支按 §9 DTD 推导补充。
 */
describe("VCardTemp", () => {
  /** Example 2：服务器返回的本用户 vCard */
  const EXAMPLE_2 = `
    <vCard xmlns="vcard-temp">
      <FN>Peter Saint-Andre</FN>
      <N>
        <FAMILY>Saint-Andre</FAMILY>
        <GIVEN>Peter</GIVEN>
        <MIDDLE/>
      </N>
      <NICKNAME>stpeter</NICKNAME>
      <URL>http://www.xmpp.org/xsf/people/stpeter.shtml</URL>
      <BDAY>1966-08-06</BDAY>
      <ORG>
        <ORGNAME>XMPP Standards Foundation</ORGNAME>
        <ORGUNIT/>
      </ORG>
      <TITLE>Executive Director</TITLE>
      <ROLE>Patron Saint</ROLE>
      <TEL><WORK/><VOICE/><NUMBER>303-308-3282</NUMBER></TEL>
      <TEL><WORK/><FAX/><NUMBER/></TEL>
      <TEL><WORK/><MSG/><NUMBER/></TEL>
      <ADR>
        <WORK/>
        <EXTADD>Suite 600</EXTADD>
        <STREET>1899 Wynkoop Street</STREET>
        <LOCALITY>Denver</LOCALITY>
        <REGION>CO</REGION>
        <PCODE>80202</PCODE>
        <CTRY>USA</CTRY>
      </ADR>
      <TEL><HOME/><VOICE/><NUMBER>303-555-1212</NUMBER></TEL>
      <TEL><HOME/><FAX/><NUMBER/></TEL>
      <TEL><HOME/><MSG/><NUMBER/></TEL>
      <ADR>
        <HOME/>
        <EXTADD/>
        <STREET/>
        <LOCALITY>Denver</LOCALITY>
        <REGION>CO</REGION>
        <PCODE>80209</PCODE>
        <CTRY>USA</CTRY>
      </ADR>
      <EMAIL><INTERNET/><PREF/><USERID>stpeter@jabber.org</USERID></EMAIL>
      <JABBERID>stpeter@jabber.org</JABBERID>
      <DESC>
        More information about me is located on my
        personal website:
http://www.saint-andre.com/
      </DESC>
    </vCard>
  `;

  /** Example 9：请求他人 vCard 时服务器返回的 vCard */
  const EXAMPLE_9 = `
    <vCard xmlns="vcard-temp">
      <FN>JeremieMiller</FN>
      <N>
        <GIVEN>Jeremie</GIVEN>
        <FAMILY>Miller</FAMILY>
        <MIDDLE/>
      </N>
      <NICKNAME>jer</NICKNAME>
      <EMAIL><INTERNET/><PREF/><USERID>jeremie@jabber.org</USERID></EMAIL>
      <JABBERID>jer@jabber.org</JABBERID>
    </vCard>
  `;

  describe("parseVCard", () => {
    it("Example 2：解析服务器返回的完整 vCard", () => {
      const vcard = VCardTemp.parseVCard(Parser.parse(EXAMPLE_2));
      expect(vcard.fn).toBe("Peter Saint-Andre");
      expect(vcard.n).toEqual({
        family: "Saint-Andre",
        given: "Peter",
        middle: "",
        prefix: undefined,
        suffix: undefined,
      });
      expect(vcard.nickname).toBe("stpeter");
      expect(vcard.url).toBe("http://www.xmpp.org/xsf/people/stpeter.shtml");
      expect(vcard.bday).toBe("1966-08-06");
      expect(vcard.org).toEqual({ orgname: "XMPP Standards Foundation", orgunits: [""] });
      expect(vcard.title).toBe("Executive Director");
      expect(vcard.role).toBe("Patron Saint");
      expect(vcard.adrs).toEqual([
        {
          type: ["WORK"],
          poBox: undefined,
          extadd: "Suite 600",
          street: "1899 Wynkoop Street",
          locality: "Denver",
          region: "CO",
          pcode: "80202",
          ctry: "USA",
        },
        {
          type: ["HOME"],
          poBox: undefined,
          extadd: "",
          street: "",
          locality: "Denver",
          region: "CO",
          pcode: "80209",
          ctry: "USA",
        },
      ]);
      expect(vcard.tels).toEqual([
        { type: ["WORK", "VOICE"], number: "303-308-3282" },
        { type: ["WORK", "FAX"], number: "" },
        { type: ["WORK", "MSG"], number: "" },
        { type: ["HOME", "VOICE"], number: "303-555-1212" },
        { type: ["HOME", "FAX"], number: "" },
        { type: ["HOME", "MSG"], number: "" },
      ]);
      expect(vcard.emails).toEqual([
        { type: ["INTERNET", "PREF"], userid: "stpeter@jabber.org" },
      ]);
      expect(vcard.jabberid).toBe("stpeter@jabber.org");
      expect(vcard.desc).toContain("personal website");
      expect(vcard.desc).toContain("http://www.saint-andre.com/");
    });

    it("Example 9：解析他人 vCard", () => {
      const vcard = VCardTemp.parseVCard(Parser.parse(EXAMPLE_9));
      expect(vcard.fn).toBe("JeremieMiller");
      expect(vcard.n).toMatchObject({ given: "Jeremie", family: "Miller", middle: "" });
      expect(vcard.nickname).toBe("jer");
      expect(vcard.emails).toEqual([
        { type: ["INTERNET", "PREF"], userid: "jeremie@jabber.org" },
      ]);
      expect(vcard.jabberid).toBe("jer@jabber.org");
    });

    it("Example 4：解析空 vCard 元素", () => {
      const vcard = VCardTemp.parseVCard(Parser.parse(`<vCard xmlns="vcard-temp"/>`));
      expect(vcard.fn).toBe("");
      expect(vcard.n).toBeUndefined();
      expect(vcard.photo).toBeUndefined();
    });

    it("Example 3：解析错误 IQ 中附带的 vCard 元素", () => {
      const iq = Parser.parse(`
        <iq id="v1" to="stpeter@jabber.org/roundabout" type="error">
          <vCard xmlns="vcard-temp"/>
          <error type="cancel">
            <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
          </error>
        </iq>
      `);
      const vcard = VCardTemp.parseVCard(iq.querySelector("vCard")!);
      expect(vcard.fn).toBe("");
    });

    it("非 vCard 元素抛错", () => {
      const xml = Parser.parse(`<x xmlns="jabber:x:data"/>`);
      expect(() => VCardTemp.parseVCard(xml)).toThrow("不是一个vCard元素");
    });

    it("按 DTD 读取 PHOTO 的 TYPE/BINVAL 与 EXTVAL 两种形式", () => {
      const binval = VCardTemp.parseVCard(Parser.parse(`
        <vCard xmlns="vcard-temp">
          <FN>x</FN>
          <PHOTO><TYPE>image/png</TYPE><BINVAL>AAAA</BINVAL></PHOTO>
        </vCard>
      `));
      expect(binval.photo).toEqual({ type: "image/png", binval: "AAAA" });
      const extval = VCardTemp.parseVCard(Parser.parse(`
        <vCard xmlns="vcard-temp">
          <FN>x</FN>
          <PHOTO><EXTVAL>https://example.net/p.png</EXTVAL></PHOTO>
        </vCard>
      `));
      expect(extval.photo).toEqual({ extval: "https://example.net/p.png" });
    });

    it("按 DTD 读取其余可选字段", () => {
      const vcard = VCardTemp.parseVCard(Parser.parse(`
        <vCard xmlns="vcard-temp">
          <FN>Juliet</FN>
          <N><FAMILY>Capulet</FAMILY><PREFIX>Ms.</PREFIX></N>
          <LABEL><WORK/><LINE>1 Main St</LINE><LINE>Verona</LINE></LABEL>
          <GEO><LAT>45.4384</LAT><LON>10.9916</LON></GEO>
          <LOGO><EXTVAL>https://example.net/logo.png</EXTVAL></LOGO>
          <CATEGORIES><KEYWORD>family</KEYWORD><KEYWORD>friends</KEYWORD></CATEGORIES>
          <SOUND><PHONETIC>ju-lee-et</PHONETIC></SOUND>
          <KEY><TYPE>X509</TYPE><CRED>AAAA</CRED></KEY>
          <CLASS>PRIVATE</CLASS>
          <UID>abc-123</UID>
        </vCard>
      `));
      expect(vcard.n?.prefix).toBe("Ms.");
      expect(vcard.labels?.[0]).toEqual({ type: ["WORK"], lines: ["1 Main St", "Verona"] });
      expect(vcard.geo).toEqual({ lat: "45.4384", lon: "10.9916" });
      expect(vcard.logo).toEqual({ extval: "https://example.net/logo.png" });
      expect(vcard.categories).toEqual(["family", "friends"]);
      expect(vcard.sound).toEqual({ phonetic: "ju-lee-et" });
      expect(vcard.key).toEqual({ type: "X509", cred: "AAAA" });
      expect(vcard.class).toBe("PRIVATE");
      expect(vcard.uid).toBe("abc-123");
    });

    it("按 DTD 解析内嵌 vCard 的 AGENT", () => {
      const xml = Parser.parse(`
        <vCard xmlns="vcard-temp">
          <FN>Main</FN>
          <AGENT><vCard xmlns="vcard-temp"><FN>Assistant</FN></vCard></AGENT>
        </vCard>
      `);
      expect(VCardTemp.parseVCard(xml).agent?.vcard?.fn).toBe("Assistant");
    });

    it("§8：读取 version 属性，兼容 DTD 的 VERSION 元素", () => {
      const attr = Parser.parse(`<vCard xmlns="vcard-temp" version="3.0"><FN>x</FN></vCard>`);
      expect(VCardTemp.parseVCard(attr).version).toBe("3.0");
      const elem = Parser.parse(`<vCard xmlns="vcard-temp"><VERSION>2.0</VERSION><FN>x</FN></vCard>`);
      expect(VCardTemp.parseVCard(elem).version).toBe("2.0");
    });

    it("兼容非规范的 <TYPE> 文本指示", () => {
      const xml = Parser.parse(`
        <vCard xmlns="vcard-temp">
          <FN>x</FN>
          <TEL><TYPE>WORK</TYPE><NUMBER>1</NUMBER></TEL>
        </vCard>
      `);
      // §9 规定 TEL 的类型是空元素，<TYPE> 仅用于 PHOTO/LOGO/KEY/SOUND
      expect(VCardTemp.parseVCard(xml).tels?.[0].number).toBe("1");
    });
  });

  describe("createVCard", () => {
    it("Example 5：构造客户端更新请求的 vCard 并可往返解析", () => {
      const vcard: Parameters<typeof VCardTemp.createVCard>[0] = {
        version: "3.0",
        fn: "Peter Saint-Andre",
        n: { family: "Saint-Andre", given: "Peter", middle: "" },
        nickname: "stpeter",
        url: "http://www.xmpp.org/xsf/people/stpeter.shtml",
        bday: "1966-08-06",
        org: { orgname: "XMPP Standards Foundation", orgunits: [""] },
        title: "Executive Director",
        role: "Patron Saint",
        tels: [
          { type: ["WORK", "VOICE"], number: "303-308-3282" },
          { type: ["WORK", "FAX"], number: "" },
          { type: ["WORK", "MSG"], number: "" },
          { type: ["HOME", "VOICE"], number: "303-555-1212" },
          { type: ["HOME", "FAX"], number: "" },
          { type: ["HOME", "MSG"], number: "" },
        ],
        adrs: [
          {
            type: ["WORK"],
            extadd: "Suite 600",
            street: "1899 Wynkoop Street",
            locality: "Denver",
            region: "CO",
            pcode: "80202",
            ctry: "USA",
          },
          {
            type: ["HOME"],
            extadd: "",
            street: "",
            locality: "Denver",
            region: "CO",
            pcode: "80209",
            ctry: "USA",
          },
        ],
        labels: [],
        emails: [{ type: ["INTERNET", "PREF"], userid: "stpeter@jabber.org" }],
        jabberid: "stpeter@jabber.org",
        desc: "Check out my blog at https://stpeter.im/",
      };
      const el = VCardTemp.createVCard(vcard);
      expect(el.namespaceURI).toBe("vcard-temp");
      expect(el.getAttribute("version")).toBe("3.0");
      expect(VCardTemp.parseVCard(el)).toEqual(vcard);
    });

    it("按 DTD 顺序输出元素", () => {
      const el = VCardTemp.createVCard({
        fn: "x",
        n: { family: "s" },
        nickname: "n",
        bday: "2000-01-01",
        adrs: [{ street: "s" }],
        tels: [{ number: "1" }],
        emails: [{ userid: "a@b" }],
        desc: "d",
        photo: { binval: "AAAA" },
      });
      const order = Array.from(el.children).map((c) => c.localName);
      expect(order).toEqual(["FN", "N", "NICKNAME", "PHOTO", "BDAY", "ADR", "TEL", "EMAIL", "DESC"]);
    });

    it("无号码时按 §8 输出空 <NUMBER/>，无 USERID 时输出空 <USERID/>", () => {
      const el = VCardTemp.createVCard({
        fn: "x",
        tels: [{}],
        emails: [{ userid: "" }],
      });
      expect(el.getElementsByTagName("NUMBER")[0].textContent).toBe("");
      expect(el.getElementsByTagName("USERID")[0].textContent).toBe("");
    });

    it("undefined 字段不生成元素", () => {
      const el = VCardTemp.createVCard({ fn: "Nobody" });
      expect(el.getElementsByTagName("N")[0]).toBeUndefined();
      expect(el.getElementsByTagName("TITLE")[0]).toBeUndefined();
      expect(el.getElementsByTagName("FN")[0].textContent).toBe("Nobody");
    });
  });
});
