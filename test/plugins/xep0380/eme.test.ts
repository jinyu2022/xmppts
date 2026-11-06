import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import { EME } from "../../../lib/plugins/xep0380/eme";

/**
 * XEP-0380 `<encryption/>` 的解析与生成。
 *
 * @see https://xmpp.org/extensions/xep-0380.html 0.4.0 §2 Examples
 */
describe("XEP-0380 加密标记", () => {
  it("命名空间不符时抛错", () => {
    const el = Parser.parse(
      `<encryption xmlns="urn:example:wrong" namespace="urn:xmpp:otr:0"/>`,
    );
    expect(() => EME.parseEncryptionEl(el)).toThrow(TypeError);
  });

  it("解析 Example 1 的 OTR 标记", () => {
    // §2 Example 1
    const el = Parser.parse(
      `<encryption xmlns="urn:xmpp:eme:0" namespace="urn:xmpp:otr:0"/>`,
    );

    expect(EME.parseEncryptionEl(el)).toEqual({
      eme: { namespace: "urn:xmpp:otr:0" },
    });
  });

  it("保留未知机制的 name", () => {
    const el = Parser.parse(
      `<encryption xmlns="urn:xmpp:eme:0" namespace="urn:example:crypto" name="Example Crypto"/>`,
    );

    expect(EME.parseEncryptionEl(el)).toEqual({
      eme: { namespace: "urn:example:crypto", name: "Example Crypto" },
    });
  });

  it("缺少 namespace 时返回空结果", () => {
    expect(
      EME.parseEncryptionEl(
        Parser.parse(`<encryption xmlns="urn:xmpp:eme:0" name="x"/>`),
      ),
    ).toEqual({});
  });

  it("createEncryptionEl 忽略已知机制的 name", () => {
    const el = EME.createEncryptionEl({
      namespace: "urn:xmpp:otr:0",
      name: "should be ignored",
    });

    expect(el.getAttribute("namespace")).toBe("urn:xmpp:otr:0");
    expect(el.getAttribute("name")).toBeNull();
  });

  it("createEncryptionEl 保留未知机制的 name", () => {
    const el = EME.createEncryptionEl({
      namespace: "urn:example:crypto",
      name: "Example Crypto",
    });

    expect(el.getAttribute("name")).toBe("Example Crypto");
  });

  it("createEncryptionEl 拒绝空的 namespace", () => {
    expect(() => EME.createEncryptionEl({ namespace: "" })).toThrow();
  });

  it("getMechanismName 返回规范列出的名称", () => {
    expect(EME.getMechanismName("urn:xmpp:otr:0")).toBe("OTR");
    expect(EME.getMechanismName("urn:xmpp:omemo:2")).toBe("OMEMO 2");
    expect(EME.getMechanismName("urn:example:crypto")).toBeUndefined();
  });
});
