import { describe, it, expect } from "vitest";
import { Form } from "../../../lib/plugins/xep0004/form";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0004: Data Forms
 * @see https://xmpp.org/extensions/xep-0004.html
 * @version 2.13.2 (2024-08-30)
 *
 * 用例取自 §5 Examples：服务器下发的（Example 2 / 8）测解析，客户端发出的
 * （Example 3）测构造；无示例的分支按 §10 XML Schema 推导补充。
 */
describe("Form", () => {
  /** Example 2：服务返回的机器人创建表单 */
  const EXAMPLE_2 = `
    <x xmlns="jabber:x:data" type="form">
      <title>Bot Configuration</title>
      <instructions>Fill out this form to configure your new bot!</instructions>
      <field type="hidden" var="FORM_TYPE">
        <value>jabber:bot</value>
      </field>
      <field type="fixed"><value>Section 1: Bot Info</value></field>
      <field type="text-single" label="The name of your bot" var="botname"/>
      <field type="text-multi" label="Helpful description of your bot" var="description"/>
      <field type="boolean" label="Public bot?" var="public">
        <required/>
      </field>
      <field type="text-private" label="Password for special access" var="password"/>
      <field type="fixed"><value>Section 2: Features</value></field>
      <field type="list-multi" label="What features will the bot support?" var="features">
        <option label="Contests"><value>contests</value></option>
        <option label="News"><value>news</value></option>
        <option label="Polls"><value>polls</value></option>
        <option label="Reminders"><value>reminders</value></option>
        <option label="Search"><value>search</value></option>
        <value>news</value>
        <value>search</value>
      </field>
      <field type="fixed"><value>Section 3: Subscriber List</value></field>
      <field type="list-single" label="Maximum number of subscribers" var="maxsubs">
        <value>20</value>
        <option label="10"><value>10</value></option>
        <option label="20"><value>20</value></option>
        <option label="30"><value>30</value></option>
        <option label="50"><value>50</value></option>
        <option label="100"><value>100</value></option>
        <option label="None"><value>none</value></option>
      </field>
      <field type="fixed"><value>Section 4: Invitations</value></field>
      <field type="jid-multi" label="People to invite" var="invitelist">
        <desc>Tell all your friends about your new bot!</desc>
      </field>
    </x>
  `;

  /** Example 3：用户提交的机器人创建表单 */
  const EXAMPLE_3 = `
    <x xmlns="jabber:x:data" type="submit">
      <field type="hidden" var="FORM_TYPE">
        <value>jabber:bot</value>
      </field>
      <field type="text-single" var="botname">
        <value>The Jabber Google Bot</value>
      </field>
      <field type="text-multi" var="description">
        <value>This bot enables you to send requests to</value>
        <value>Google and receive the search results right</value>
        <value>in your Jabber client. It&apos; really cool!</value>
        <value>It even supports Google News!</value>
      </field>
      <field type="boolean" var="public">
        <value>0</value>
      </field>
      <field type="text-private" var="password">
        <value>v3r0na</value>
      </field>
      <field type="list-multi" var="features">
        <value>news</value>
        <value>search</value>
      </field>
      <field type="list-single" var="maxsubs">
        <value>50</value>
      </field>
      <field type="jid-multi" var="invitelist">
        <value>juliet@capulet.com</value>
        <value>benvolio@montague.net</value>
      </field>
    </x>
  `;

  /** Example 8：服务返回的搜索结果（reported + item） */
  const EXAMPLE_8 = `
    <x xmlns="jabber:x:data" type="result">
      <title>Joogle Search: verona</title>
      <reported>
        <field var="name"/>
        <field var="url"/>
      </reported>
      <item>
        <field var="name">
          <value>Comune di Verona - Benvenuti nel sito ufficiale</value>
        </field>
        <field var="url">
          <value>http://www.comune.verona.it/</value>
        </field>
      </item>
      <item>
        <field var="name">
          <value>benvenuto!</value>
        </field>
        <field var="url">
          <value>http://www.hellasverona.it/</value>
        </field>
      </item>
    </x>
  `;

  describe("parseFormEl", () => {
    it("Example 2：解析服务端下发的表单", () => {
      const form = Form.parseFormEl(Parser.parse(EXAMPLE_2)).form;
      const byVar = (v: string) => form.fields.find((f) => f.var === v)!;

      expect(form.type).toBe("form");
      expect(form.title).toBe("Bot Configuration");
      expect(form.instructions).toBe("Fill out this form to configure your new bot!");
      expect(form.fields).toHaveLength(12);

      const formType = byVar("FORM_TYPE");
      expect(formType.type).toBe("hidden");
      expect(formType.values).toEqual(["jabber:bot"]);

      const section = form.fields[1];
      expect(section.type).toBe("fixed");
      expect(section.var).toBeUndefined();
      expect(section.values).toEqual(["Section 1: Bot Info"]);

      const publicField = byVar("public");
      expect(publicField.type).toBe("boolean");
      expect(publicField.label).toBe("Public bot?");
      expect(publicField.required).toBe(true);
      expect(publicField.values).toEqual([]);

      const features = byVar("features");
      expect(features.type).toBe("list-multi");
      expect(features.values).toEqual(["news", "search"]);
      expect(features.options).toEqual([
        { label: "Contests", value: "contests" },
        { label: "News", value: "news" },
        { label: "Polls", value: "polls" },
        { label: "Reminders", value: "reminders" },
        { label: "Search", value: "search" },
      ]);

      const maxsubs = byVar("maxsubs");
      expect(maxsubs.type).toBe("list-single");
      expect(maxsubs.values).toEqual(["20"]);
      expect(maxsubs.options).toHaveLength(6);

      const invitelist = byVar("invitelist");
      expect(invitelist.type).toBe("jid-multi");
      expect(invitelist.desc).toBe("Tell all your friends about your new bot!");
      expect(invitelist.values).toEqual([]);
    });

    it("Example 8：解析 result 表单的 reported 与 item", () => {
      const form = Form.parseFormEl(Parser.parse(EXAMPLE_8)).form;
      expect(form.type).toBe("result");
      expect(form.title).toBe("Joogle Search: verona");
      expect(form.fields).toEqual([]);
      expect(form.reported).toHaveLength(2);
      expect(form.reported?.[0].var).toBe("name");
      expect(form.reported?.[0].type).toBe("text-single");
      expect(form.reported?.[0].values).toEqual([]);
      expect(form.items).toHaveLength(2);
      expect(form.items?.[1].fields).toEqual([
        { type: "text-single", var: "name", label: undefined, desc: undefined, required: false, values: ["benvenuto!"] },
        { type: "text-single", var: "url", label: undefined, desc: undefined, required: false, values: ["http://www.hellasverona.it/"] },
      ]);
    });

    it("§3.6：保留缺失 value 与空 value 的原始表示", () => {
      const form = Form.parseFormEl(Parser.parse(`
        <x xmlns="jabber:x:data" type="submit">
          <field var="absent"/>
          <field var="empty"><value/></field>
          <field var="explicit-empty"><value></value></field>
        </x>
      `)).form;

      expect(form.fields.map((field) => field.values)).toEqual([[], [""], [""]]);
      const xml = Form.createFormEl(form);
      expect(xml.getElementsByTagName("value")).toHaveLength(2);
      expect(Form.parseFormEl(Parser.parse(xml.toXMLString())).form).toEqual(form);
    });

    it("text-multi 的首尾与中间空行可往返保留", () => {
      const form = Form.parseFormEl(Parser.parse(`
        <x xmlns="jabber:x:data" type="form">
          <field var="description" type="text-multi">
            <value/><value>First line</value><value/><value>Last line</value><value/>
          </field>
        </x>
      `)).form;

      expect(form.fields[0].values).toEqual(["", "First line", "", "Last line", ""]);
      const xml = Form.createFormEl(form).toXMLString();
      expect(Form.parseFormEl(Parser.parse(xml)).form).toEqual(form);
    });

    it("非 jabber:x:data 元素抛错", () => {
      expect(() => Form.parseFormEl(Parser.parse(`<x xmlns="other"/>`))).toThrow("不是一个data form");
    });

    it("§3.2：type 缺失或不可识别时视为 text-single", () => {
      const form = Form.parseFormEl(Parser.parse(`
        <x xmlns="jabber:x:data" type="form">
          <field var="a"><value>1</value></field>
          <field var="b" type="unknown"><value>2</value></field>
        </x>
      `)).form;
      expect(form.fields[0].type).toBe("text-single");
      expect(form.fields[1].type).toBe("text-single");
    });
  });

  describe("createFormEl", () => {
    it("Example 3：构造客户端提交表单并可往返解析", () => {
      const data = Form.parseFormEl(Parser.parse(EXAMPLE_3)).form;
      const el = Form.createFormEl(data);
      expect(el.namespaceURI).toBe("jabber:x:data");
      expect(el.getAttribute("type")).toBe("submit");
      expect(Form.parseFormEl(el).form).toEqual(data);
    });

    it("Example 8：构造 result 表单的 reported 与 item 并可往返解析", () => {
      const data = Form.parseFormEl(Parser.parse(EXAMPLE_8)).form;
      const el = Form.createFormEl(data);
      const names = Array.from(el.children).map((c) => c.localName);
      // §10 schema 顺序：title, field*, reported, item*
      expect(names).toEqual(["title", "reported", "item", "item"]);
      expect(Form.parseFormEl(el).form).toEqual(data);
    });
  });
});


