import { describe, it, expect } from "vitest";
import { XEP0128 } from "../../../lib/plugins/xep0128";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0128: Service Discovery Extensions
 * @see https://xmpp.org/extensions/xep-0128.html
 * @version 1.0.1 (2019-07-30)
 *
 * 用例取自 §3 Examples：服务器下发的扩展信息（Example 1/2）测解析；
 * 无示例分支按 §2 Recommendations 推导补充。
 */
describe("XEP0128", () => {
  /** Example 1：IM 服务器的 disco 扩展信息 */
  const EXAMPLE_1 = `
    <iq type="result" from="shakespeare.lit" to="capulet.com" id="disco1">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="server" type="im" name="shakespeare.lit jabber server"/>
        <feature var="jabber:iq:register"/>
        <x xmlns="jabber:x:data" type="result">
          <field var="FORM_TYPE" type="hidden">
            <value>http://jabber.org/network/serverinfo</value>
          </field>
          <field var="c2s_port">
            <value>5222</value>
          </field>
          <field var="c2s_port_ssl">
            <value>5223</value>
          </field>
          <field var="http_access">
            <value>http://shakespeare.lit/jabber</value>
          </field>
          <field var="ip_version">
            <value>ipv4</value>
            <value>ipv6</value>
          </field>
          <field var="info_url">
            <value>http://shakespeare.lit/support.php</value>
          </field>
        </x>
      </query>
    </iq>
  `;

  /** Example 2：MUC 房间的 disco 扩展信息 */
  const EXAMPLE_2 = `
    <iq type="result" from="darkcave@macbeth.shakespeare.lit" to="hag66@shakespeare.lit/pda" id="disco1">
      <query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="conference" type="text" name="A Dark Cave"/>
        <feature var="http://jabber.org/protocol/muc"/>
        <x xmlns="jabber:x:data" type="result">
          <field var="FORM_TYPE" type="hidden">
            <value>http://jabber.org/protocol/muc#roominfo</value>
          </field>
          <field var="muc#roominfo_description" label="Description">
            <value>The place for all good witches!</value>
          </field>
          <field var="muc#roominfo_subject" label="Subject">
            <value>Spells</value>
          </field>
          <field var="muc#roominfo_occupants" label="Number of occupants">
            <value>3</value>
          </field>
          <field var="muc#roominfo_lang" label="Language of discussion">
            <value>en</value>
          </field>
        </x>
      </query>
    </iq>
  `;

  describe("parseDataForm", () => {
    it("Example 1：解析 IM 服务器的扩展表单", () => {
      const form = XEP0128.parseDataForm(Parser.parse(EXAMPLE_1)).form!;
      const byVar = (v: string) => form.fields.find((f) => f.var === v)!;
      expect(form.type).toBe("result");
      expect(form.fields).toHaveLength(6);
      expect(byVar("FORM_TYPE").type).toBe("hidden");
      expect(byVar("FORM_TYPE").values).toEqual(["http://jabber.org/network/serverinfo"]);
      expect(byVar("c2s_port").values).toEqual(["5222"]);
      // §2：一个 field 可含多个 value
      expect(byVar("ip_version").values).toEqual(["ipv4", "ipv6"]);
    });

    it("Example 2：解析 MUC 房间的扩展表单", () => {
      const form = XEP0128.parseDataForm(Parser.parse(EXAMPLE_2)).form!;
      const byVar = (v: string) => form.fields.find((f) => f.var === v)!;
      expect(byVar("FORM_TYPE").values).toEqual(["http://jabber.org/protocol/muc#roominfo"]);
      expect(byVar("muc#roominfo_description").values).toEqual(["The place for all good witches!"]);
      expect(byVar("muc#roominfo_occupants").values).toEqual(["3"]);
    });

    it("直接传入 jabber:x:data 元素亦可解析", () => {
      const form = XEP0128.parseDataForm(Parser.parse(EXAMPLE_2)).form!;
      const direct = XEP0128.parseDataForm(Parser.parse(`
        <x xmlns="jabber:x:data" type="result">
          <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#roominfo</value></field>
        </x>
      `)).form!;
      expect(form.type).toBe("result");
      expect(direct.fields[0].values[0]).toBe("http://jabber.org/protocol/muc#roominfo");
    });

    it("无数据表单时 form 为 undefined", () => {
      const xml = Parser.parse(`
        <query xmlns="http://jabber.org/protocol/disco#info">
          <identity category="server" type="im"/>
        </query>
      `);
      expect(XEP0128.parseDataForm(xml).form).toBeUndefined();
    });
  });
});
