import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { Message } from "../../../lib/stanza";
import Reference from "../../../lib/plugins/xep0372/reference";

/**
 * XEP-0372: References
 * @see https://xmpp.org/extensions/xep-0372.html
 * @version 0.5.0
 *
 * §3.2 的正文与 mention 属性、§3.3 的 data 引用、§3.4 的 anchor 引用均取自规范示例；
 * 规范没有一条消息携带两个引用的示例，多引用用例由 §3.2 与 §3.3 组合而成。
 */
describe("Reference", () => {
  /** §3.2 的消息正文 */
  const BODY =
    "But, soft! what light through yonder window breaks? It is the east, and Juliet is the sun.";
  /** §3.3 / §3.4 的 data 引用 URI */
  const FDP_URI =
    "xmpp:fdp.shakespeare.lit?;node=fdp/submitted/stan.isode.net/accidentreport;item=ndina872be";
  /** §3.4 的 anchor，指向原消息 */
  const ANCHOR = "xmpp:balcony@channels.shakespeare.lit?;node=messages;item=bnhob";

  /** §3.2 mention 与 §3.3 data 的组合，用于验证逐元素解析 */
  const MESSAGE = `
    <message type="groupchat" id="sotehu-bthbtp32h3" to="balcony@channels.shakespeare.lit">
      <body>${BODY}</body>
      <reference xmlns="urn:xmpp:reference:0"
                 begin="72"
                 end="78"
                 type="mention"
                 uri="xmpp:juliet@capulet.lit"/>
      <reference xmlns="urn:xmpp:reference:0"
                 type="data"
                 uri="${FDP_URI}"/>
    </message>`;

  describe("parseReferenceEl", () => {
    it("一次只解析当前引用元素", () => {
      const message = Parser.parse(MESSAGE);
      const elements = message.getElementsByTagNameNS(
        Reference.NS,
        "reference",
      );

      // §3.2 mention：带区间
      expect(Reference.parseReferenceEl(elements[0])).toEqual({
        references: [
          {
            type: "mention",
            uri: "xmpp:juliet@capulet.lit",
            begin: 72,
            end: 78,
          },
        ],
      });
      // §3.3 data：规范示例不带 begin/end
      expect(Reference.parseReferenceEl(elements[1])).toEqual({
        references: [{ type: "data", uri: FDP_URI }],
      });
    });

    it("解析 §3.4 的 anchor 示例", () => {
      const message = Parser.parse(`
        <message type="groupchat"
                 id="sotehu-bthbtp32h5"
                 from="balcony@channels.shakespeare.lit"
                 to="romeo@montegue.lit/30d3d8">
          <reference xmlns="urn:xmpp:reference:0"
                     type="data"
                     anchor="${ANCHOR}"
                     begin="72"
                     end="78"
                     uri="${FDP_URI}"/>
        </message>`);
      const el = message.getElementsByTagName("reference")[0];
      expect(Reference.parseReferenceEl(el)).toEqual({
        references: [
          {
            type: "data",
            uri: FDP_URI,
            begin: 72,
            end: 78,
            anchor: ANCHOR,
          },
        ],
      });
    });

    it("忽略非法偏移", () => {
      // §3.4 的 type、uri、anchor 保持不变，仅把 begin/end 换成非法值
      const el = Parser.parse(`
        <reference xmlns="urn:xmpp:reference:0"
                   type="data"
                   uri="${FDP_URI}"
                   begin="-1"
                   end="abc"
                   anchor="${ANCHOR}"/>`);
      expect(Reference.parseReferenceEl(el)).toEqual({
        references: [{ type: "data", uri: FDP_URI, anchor: ANCHOR }],
      });
    });

    it("只接受十进制整数偏移", () => {
      // 同上，仅把 begin/end 换成 Number() 能接受的非十进制写法
      const el = Parser.parse(`
        <reference xmlns="urn:xmpp:reference:0"
                   type="data"
                   uri="${FDP_URI}"
                   begin="1e3"
                   end="0x10"/>`);
      expect(Reference.parseReferenceEl(el)).toEqual({
        references: [{ type: "data", uri: FDP_URI }],
      });
    });

    it("缺少 type 或 uri 的条目被忽略", () => {
      // §3.2 的 mention 分别去掉 uri 与 type
      const noUri = Parser.parse(
        `<reference xmlns="urn:xmpp:reference:0" type="mention" begin="72" end="78"/>`,
      );
      expect(Reference.parseReferenceEl(noUri)).toEqual({});

      const noType = Parser.parse(
        `<reference xmlns="urn:xmpp:reference:0" uri="xmpp:juliet@capulet.lit"/>`,
      );
      expect(Reference.parseReferenceEl(noType)).toEqual({});
    });

    it("命名空间不符时抛错", () => {
      const el = Parser.parse(
        `<reference xmlns="urn:example:wrong" type="mention" uri="xmpp:romeo@montague.lit"/>`,
      );
      expect(() => Reference.parseReferenceEl(el)).toThrow(
        "不是一个 reference 元素",
      );
    });

  });

  describe("createReferenceEl", () => {
    it("缺少 type 或 uri 时抛错", () => {
      expect(() =>
        Reference.createReferenceEl({ type: "", uri: "xmpp:a@b" }),
      ).toThrow("必须包含 type 与 uri");
    });

    it("拒绝非法偏移与 begin > end", () => {
      expect(() =>
        Reference.createReferenceEl({
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          begin: -1,
        }),
      ).toThrow("必须是非负整数");
      expect(() =>
        Reference.createReferenceEl({
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          begin: 78,
          end: 72,
        }),
      ).toThrow("begin 不能大于 end");
    });

    it("begin 与 end 必须成对出现", () => {
      // §3.2：引用不是正文子串时两者都不用，只给一端的区间无法解释
      expect(() =>
        Reference.createReferenceEl({
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          begin: 72,
        }),
      ).toThrow("必须同时给出或同时省略");
      expect(() =>
        Reference.createReferenceEl({
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          end: 78,
        }),
      ).toThrow("必须同时给出或同时省略");
    });
  });

  describe("appendReferences", () => {
    it("把引用附加到已有消息上", () => {
      // §3.2 的 to/body/type 与引用属性
      const message = Message.createMessage(
        "balcony@channels.shakespeare.lit",
        BODY,
        "groupchat",
      );
      const result = Reference.appendReferences(message, [
        {
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          begin: 72,
          end: 78,
        },
      ]);

      // 返回同一个消息元素，正文等已有内容不受影响
      expect(result).toBe(message);
      expect(message.getAttribute("type")).toBe("groupchat");
      expect(message.getElementsByTagName("body")[0].textContent).toBe(BODY);
      const reference = message.getElementsByTagName("reference")[0];
      expect(reference.namespaceURI).toBe(Reference.NS);
      expect(reference.getAttribute("type")).toBe("mention");
      expect(reference.getAttribute("uri")).toBe("xmpp:juliet@capulet.lit");
      expect(reference.getAttribute("begin")).toBe("72");
      expect(reference.getAttribute("end")).toBe("78");
    });

    it("anchor 引用可以不带正文", () => {
      // §3.4 的完整引用属性
      const message = Message.createMessage(
        "romeo@montegue.lit/30d3d8",
        undefined,
        "groupchat",
      );
      Reference.appendReferences(message, [
        { type: "data", uri: FDP_URI, anchor: ANCHOR, begin: 72, end: 78 },
      ]);

      expect(message.getElementsByTagName("body")).toHaveLength(0);
      const reference = message.getElementsByTagName("reference")[0];
      expect(reference.getAttribute("anchor")).toBe(ANCHOR);
      expect(reference.getAttribute("begin")).toBe("72");
      expect(reference.getAttribute("end")).toBe("78");
    });

    it("带 anchor 的引用不得与正文共存", () => {
      // §3.4 的引用 + §3.2 的正文：规范示例本身不带正文，组合后覆盖抛错
      const message = Message.createMessage(
        "romeo@montegue.lit/30d3d8",
        BODY,
        "groupchat",
      );
      expect(() =>
        Reference.appendReferences(message, [
          { type: "data", uri: FDP_URI, anchor: ANCHOR, begin: 72, end: 78 },
        ]),
      ).toThrow("不得包含正文");
    });
  });

  describe("appendTextReference", () => {
    it("按正文文本定位，区间与 §3.2 示例一致", () => {
      const message = Message.createMessage(
        "balcony@channels.shakespeare.lit",
        BODY,
        "groupchat",
      );
      const result = Reference.appendTextReference(message, "Juliet", {
        type: "mention",
        uri: "xmpp:juliet@capulet.lit",
      });

      expect(result).toBe(message);
      // §3.2 给出的 begin=72、end=78 正是 Juliet 在正文中的码点区间
      const reference = message.getElementsByTagName("reference")[0];
      expect(reference.getAttribute("begin")).toBe("72");
      expect(reference.getAttribute("end")).toBe("78");
      expect(reference.getAttribute("type")).toBe("mention");
      expect(reference.getAttribute("uri")).toBe("xmpp:juliet@capulet.lit");
    });

    it("UTF-16 下标与码点不一致时按码点换算", () => {
      const message = Message.createMessage(
        "balcony@channels.shakespeare.lit",
        "😀 @juliet 你好",
        "groupchat",
      );
      Reference.appendTextReference(message, "@juliet", {
        type: "mention",
        uri: "xmpp:juliet@capulet.lit",
      });

      // 😀 占两个 UTF-16 码元，码点区间为 [2, 9)
      const reference = message.getElementsByTagName("reference")[0];
      expect(reference.getAttribute("begin")).toBe("2");
      expect(reference.getAttribute("end")).toBe("9");
    });

    it("正文中出现多次时取第一处", () => {
      const message = Message.createMessage(
        "balcony@channels.shakespeare.lit",
        "@juliet @juliet",
      );
      Reference.appendTextReference(message, "@juliet", {
        type: "mention",
        uri: "xmpp:juliet@capulet.lit",
      });
      const reference = message.getElementsByTagName("reference")[0];
      expect(reference.getAttribute("begin")).toBe("0");
      expect(reference.getAttribute("end")).toBe("7");
    });

    it("没有正文或找不到文本时抛错", () => {
      const empty = Message.createMessage(
        "balcony@channels.shakespeare.lit",
      );
      expect(() =>
        Reference.appendTextReference(empty, "@juliet", {
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
        }),
      ).toThrow("没有正文");

      // §3.2 的正文没有 @ 符号，按 @juliet 找不到
      const message = Message.createMessage(
        "balcony@channels.shakespeare.lit",
        BODY,
        "groupchat",
      );
      expect(() =>
        Reference.appendTextReference(message, "@juliet", {
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
        }),
      ).toThrow("找不到引用文本");

      expect(() =>
        Reference.appendTextReference(message, "", {
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
        }),
      ).toThrow("不能为空");
    });
  });
});
