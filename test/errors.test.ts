import { describe, expect, it } from "vitest";
import { ErrorConditions, TimeoutError, XMPPError } from "../lib/errors";
import { Parser } from "../lib/ltx/Parser";

/**
 * XMPPError / TimeoutError 单元测试。
 * 覆盖 <error/> 节解析（condition/type/text）、非直接子元素与命名空间隔离、
 * 非法 condition 忽略，以及 stanza 上下文字段的快照。
 *
 * @see https://xmpp.org/extensions/xep-0077.html 2.4 §3.1.1（Example 6 的 iq error 结构）
 */
const STANZAS_NS = "urn:ietf:params:xml:ns:xmpp-stanzas";

describe("XMPPError", () => {
  it("从 stanza 快照基础信息并解析 <error/> 的 condition/type/text", () => {
    // 规范 Example 6：用户名冲突错误（补上服务端 from 与说明文本）
    const stanza = Parser.parse(
      `<iq xmlns="jabber:client" type="error" id="reg2" from="shakespeare.lit" to="bill@shakespeare.lit/globe">
        <query xmlns="jabber:iq:register">
          <username>bill</username>
        </query>
        <error code="409" type="cancel">
          <conflict xmlns="${STANZAS_NS}"/>
          <text xmlns="${STANZAS_NS}">Username already taken</text>
        </error>
      </iq>`,
    );

    const error = new XMPPError(stanza, "请求失败");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("XMPPError");
    expect(error.message).toBe("请求失败");
    expect(error.tagName).toBe("iq");
    expect(error.to).toBe("bill@shakespeare.lit/globe");
    expect(error.from).toBe("shakespeare.lit");
    expect(error.xmlString).toContain('id="reg2"');
    expect(error.condition).toBe("conflict");
    expect(error.type).toBe("cancel");
    expect(error.text).toBe("Username already taken");
  });

  it("缺少 <error/> 时 condition/type/text 均为 undefined", () => {
    const error = new XMPPError(
      Parser.parse(`<message xmlns="jabber:client" type="error"/>`),
      "空错误",
    );

    expect(error.condition).toBeUndefined();
    expect(error.type).toBeUndefined();
    expect(error.text).toBeUndefined();
  });

  it("只取直接子元素 <error/>，不误取转发消息里嵌套的 error", () => {
    const stanza = Parser.parse(
      `<message xmlns="jabber:client" type="chat">
        <body>转发</body>
        <forwarded xmlns="urn:xmpp:forward:0">
          <message xmlns="jabber:client" type="error">
            <error type="wait"><remote-server-timeout xmlns="${STANZAS_NS}"/></error>
          </message>
        </forwarded>
      </message>`,
    );

    const error = new XMPPError(stanza, "外层无错误");
    expect(error.condition).toBeUndefined();
    expect(error.type).toBeUndefined();
  });

  it("未知 condition 原样保留，type 仍保留", () => {
    const stanza = Parser.parse(
      `<presence xmlns="jabber:client" type="error">
        <error type="modify"><foo-bar xmlns="${STANZAS_NS}"/></error>
      </presence>`,
    );

    const error = new XMPPError(stanza, "未知条件");
    expect(error.condition).toBe("foo-bar");
    expect(error.type).toBe("modify");
  });

  it("只取 stanzas 命名空间下的 <text/>", () => {
    const stanza = Parser.parse(
      `<iq xmlns="jabber:client" type="error">
        <error type="cancel">
          <service-unavailable xmlns="${STANZAS_NS}"/>
          <text xmlns="urn:other">其他命名空间</text>
        </error>
      </iq>`,
    );

    const error = new XMPPError(stanza, "错误");
    expect(error.condition).toBe("service-unavailable");
    // 无匹配的 <text/> 时为 undefined
    expect(error.text).toBeUndefined();
  });

  it("已知条件清单包含 RFC 6120 §8.3 的常用条件", () => {
    expect(ErrorConditions).toContain("bad-request");
    expect(ErrorConditions).toContain("service-unavailable");
    expect(ErrorConditions).toContain("unexpected-request");
    expect(new Set(ErrorConditions).size).toBe(ErrorConditions.length);
  });
});

describe("TimeoutError", () => {
  it("保留 name 与 message，可被 instanceof 识别", () => {
    const error = new TimeoutError("超时了");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe("超时了");
  });
});
