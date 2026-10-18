import { describe, expect, it } from "vitest";
import { Parser, XMPPElement } from "../lib/ltx";
import {
  BIND_NS,
  STREAM_NS,
  buildBindRequest,
  collectStreamFeatures,
  getStreamErrorCondition,
  isStreamError,
  isStreamFeatures,
  parseBindResult,
  parseSaslEvent,
} from "../lib/transport/stream-connection";
import {
  SASL_NS,
  SaslClient,
  parseSaslAttributes,
  utf8ToBase64,
} from "../lib/auth/sasl";
import { JID } from "../lib/JID";

function parse(xml: string): XMPPElement {
  return Parser.parse(xml);
}

describe("流协商辅助函数", () => {
  it("把非 ASCII 文本编码为 UTF-8 Base64", () => {
    const text = "päss";
    const binary = atob(utf8ToBase64(text));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it("解析 SASL 属性", () => {
    expect(parseSaslAttributes("e=extra,v=abc123,x=1")).toEqual({
      e: "extra",
      v: "abc123",
      x: "1",
    });
  });

  it("识别 stream features 与 stream error", () => {
    const features = parse(
      `<stream:features xmlns:stream="${STREAM_NS}"><bind xmlns="${BIND_NS}"/></stream:features>`,
    );
    const error = parse(
      `<stream:error xmlns:stream="${STREAM_NS}">
        <policy-violation xmlns="urn:ietf:params:xml:ns:xmpp-streams"/>
      </stream:error>`,
    );

    expect(isStreamFeatures(features)).toBe(true);
    expect(isStreamError(error)).toBe(true);
    expect(getStreamErrorCondition(error)).toBe("policy-violation");
  });

  it("收集宣告的 feature 命名空间", () => {
    const features = parse(
      `<stream:features xmlns:stream="${STREAM_NS}">
        <bind xmlns="${BIND_NS}"/>
        <sm xmlns="urn:xmpp:sm:3"/>
      </stream:features>`,
    );

    expect(collectStreamFeatures(features).namespaces).toEqual(
      new Set([BIND_NS, "urn:xmpp:sm:3"]),
    );
  });

  it("解析 SASL 事件", () => {
    const failure = parse(
      `<failure xmlns="${SASL_NS}"><not-authorized/><text>nope</text></failure>`,
    );

    expect(parseSaslEvent(failure)).toEqual({
      type: "failure",
      condition: "not-authorized",
    });
    expect(parseSaslEvent(parse(`<success xmlns="${SASL_NS}"/>`))).toEqual({
      type: "success",
      payload: "",
    });
    // 非 SASL 命名空间的节由调用方放行
    expect(parseSaslEvent(parse("<message/>"))).toBeUndefined();
  });
});

describe("SaslClient", () => {
  it("优先选择 SCRAM-SHA-1", () => {
    const client = new SaslClient(new JID("juliet@capulet.lit/balcony"));
    client.start(["PLAIN", "SCRAM-SHA-1"], "pass");
    expect(client.mechanism).toBe("SCRAM-SHA-1");
  });

  it("拒绝不受支持的 SASL 机制", () => {
    const client = new SaslClient(new JID("juliet@capulet.lit/balcony"));
    expect(() => client.start(["EXTERNAL"], "pass")).toThrow(
      "不受支持的认证机制",
    );
  });

  it("构造 UTF-8 的 PLAIN 认证请求", () => {
    const client = new SaslClient(new JID("用户@capulet.lit/client"));
    const auth = parse(client.start(["PLAIN"], "密码"));
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(auth.textContent), (character) =>
        character.charCodeAt(0),
      ),
    );

    expect(client.mechanism).toBe("PLAIN");
    expect(auth.namespaceURI).toBe(SASL_NS);
    expect(auth.getAttribute("mechanism")).toBe("PLAIN");
    expect(decoded).toBe("\0用户\0密码");
  });

  it("接受 PLAIN 成功", async () => {
    const client = new SaslClient(new JID("juliet@capulet.lit/balcony"));
    client.start(["PLAIN"], "pass");

    await expect(
      client.process({ type: "success", payload: "" }, "pass"),
    ).resolves.toEqual({ type: "success" });
  });

  it("暴露 PLAIN failure 条件", async () => {
    const client = new SaslClient(new JID("juliet@capulet.lit/balcony"));
    client.start(["PLAIN"], "pass");

    await expect(
      client.process({ type: "failure", condition: "not-authorized" }, "pass"),
    ).rejects.toThrow("认证失败: not-authorized");
  });
});

describe("资源绑定辅助函数", () => {
  it("构造带唯一 id 且已转义的 bind 请求", () => {
    const request = buildBindRequest("bad</resource><x/>");
    const iq = parse(request.data);

    expect(iq.getAttribute("id")).toBe(request.id);
    expect(request.id.startsWith("bind-")).toBe(true);
    expect(iq.getAttribute("type")).toBe("set");
    expect(request.data).toContain("&lt;");
    expect(request.data).not.toMatch(/<\/resource><x\/>/);
    expect(iq.getElementsByTagName("bind")[0]?.namespaceURI).toBe(BIND_NS);
  });

  it("接受服务端改写的资源", () => {
    const response = parse(
      `<iq type="result" id="bind-x">
        <bind xmlns="${BIND_NS}">
          <jid>juliet@capulet.lit/server-rewritten</jid>
        </bind>
      </iq>`,
    );

    expect(parseBindResult(response, "juliet@capulet.lit").toString()).toBe(
      "juliet@capulet.lit/server-rewritten",
    );
  });

  it("暴露 bind IQ 错误", () => {
    const response = parse(
      `<iq type="error" id="bind-x">
        <error type="cancel">
          <conflict xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
        </error>
      </iq>`,
    );

    expect(() => parseBindResult(response, "juliet@capulet.lit")).toThrow(
      "资源绑定失败: conflict",
    );
  });

  it("拒绝不一致的 bare JID", () => {
    const response = parse(
      `<iq type="result" id="bind-x">
        <bind xmlns="${BIND_NS}"><jid>romeo@montague.lit/r</jid></bind>
      </iq>`,
    );

    expect(() => parseBindResult(response, "juliet@capulet.lit")).toThrow(
      "不一致",
    );
  });
});
