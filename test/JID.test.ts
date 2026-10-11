import { describe, expect, it } from "vitest";
import { JID } from "../lib/JID";

describe("JID 解析", () => {
  it("解析 local、domain 与 resource", () => {
    const jid = new JID("user@example.com/phone");

    expect(jid.local).toBe("user");
    expect(jid.domain).toBe("example.com");
    expect(jid.resource).toBe("phone");
    expect(jid.bare).toBe("user@example.com");
    expect(jid.full).toBe("user@example.com/phone");
    expect(jid.toString()).toBe("user@example.com/phone");
  });

  it("无 resource 时 full 与 toString 都返回 bare", () => {
    const jid = new JID("user@example.com");

    expect(jid.resource).toBeUndefined();
    expect(jid.full).toBe("user@example.com");
    expect(jid.toString()).toBe("user@example.com");
    expect(new JID(jid.full).equals(jid)).toBe(true);
  });

  it("resource 可包含 / 与 @", () => {
    const jid = new JID("user@example.com/a/b@c");

    expect(jid.resource).toBe("a/b@c");
    expect(jid.toString()).toBe("user@example.com/a/b@c");
  });

  it("解析域 JID（无 localpart）", () => {
    const jid = new JID("example.com");

    expect(jid.local).toBe("");
    expect(jid.domain).toBe("example.com");
    expect(jid.resource).toBeUndefined();
    expect(jid.bare).toBe("example.com");
    expect(jid.full).toBe("example.com");
    expect(jid.toString()).toBe("example.com");
  });

  it("解析域 JID 带 resource", () => {
    const jid = new JID("example.com/foobar");

    expect(jid.local).toBe("");
    expect(jid.domain).toBe("example.com");
    expect(jid.resource).toBe("foobar");
    expect(jid.full).toBe("example.com/foobar");
    expect(jid.toString()).toBe("example.com/foobar");
  });

  it("拒绝缺少 domain 或含空段的字符串", () => {
    expect(() => new JID("@example.com")).toThrow("无效的 JID 格式");
    expect(() => new JID("user@")).toThrow("无效的 JID 格式");
    expect(() => new JID("/foobar")).toThrow("无效的 JID 格式");
    expect(() => new JID("user@example.com/")).toThrow("无效的 JID 格式");
  });

  it("拒绝含多个 @ 的 local 部分", () => {
    expect(() => new JID("a@b@example.com")).toThrow("无效的 JID 格式");
  });
});

describe("JID.equals", () => {
  it("支持 JID 与字符串比较", () => {
    const jid = new JID("user@example.com/phone");

    expect(jid.equals("user@example.com/phone")).toBe(true);
    expect(jid.equals(new JID("user@example.com/phone"))).toBe(true);
    expect(jid.equals("user@example.com")).toBe(false);
    expect(jid.equals(new JID("user@example.com/tablet"))).toBe(false);
  });

  it("已知非 JID 对象静态推导为 false", () => {
    expect(new JID("user@example.com").equals({})).toBe(false);
  });
});

describe("JID 转义与大小写归一（XEP-0106 / RFC 7622）", () => {
  it("构造时转义 localpart，getLocal(true) / toString(true) 返回展示形式", () => {
    const jid = new JID("space cadet@example.com");

    expect(jid.local).toBe(String.raw`space\20cadet`);
    expect(jid.bare).toBe(String.raw`space\20cadet@example.com`);
    expect(jid.toString()).toBe(String.raw`space\20cadet@example.com`);
    expect(jid.getLocal(true)).toBe("space cadet");
    expect(jid.toString(true)).toBe("space cadet@example.com");
  });

  it("线上已转义的 JID 不再二次转义，展示时还原", () => {
    const jid = new JID(String.raw`d\27artagnan@example.com/table`);

    expect(jid.local).toBe(String.raw`d\27artagnan`);
    expect(jid.toString()).toBe(String.raw`d\27artagnan@example.com/table`);
    expect(jid.toString(true)).toBe("d'artagnan@example.com/table");
  });

  it("localpart（转义后）与 domain 小写归一，resource 保持原样", () => {
    const jid = new JID("Juliet@Capulet.LIT/balcony");

    expect(jid.local).toBe("juliet");
    expect(jid.domain).toBe("capulet.lit");
    expect(jid.resource).toBe("balcony");
    expect(jid.equals("juliet@capulet.lit/balcony")).toBe(true);
    expect(jid.equals(new JID("JULIET@capulet.lit/BALCONY"))).toBe(false);
  });

  it("域 JID 无 localpart，展示形式同样为空串", () => {
    const jid = new JID("Example.COM");

    expect(jid.local).toBe("");
    expect(jid.getLocal(true)).toBe("");
    expect(jid.toString()).toBe("example.com");
  });

  it("大小写不同的同一 JID 归一后 equals 相等", () => {
    expect(new JID("User@Example.COM").equals(new JID("user@example.com"))).toBe(true);
  });

  it("domainpart 末尾的标签分隔点被剥离（RFC 7622 §3.2）", () => {
    const jid = new JID("user@example.com.");

    expect(jid.domain).toBe("example.com");
    expect(jid.bare).toBe("user@example.com");
    expect(jid.equals(new JID("user@example.com"))).toBe(true);
    expect(new JID("user@example.com./tablet").toString()).toBe("user@example.com/tablet");
    expect(new JID("example.com.").toString()).toBe("example.com");
  });
});

describe("JID 的 Unicode NFC 归一（RFC 7622 + RFC 8265）", () => {
  /** `u\u0308` 与 `\u00FC` 是 ü 的分解/合成两种写法 */
  const DECOMPOSED = "u\u0308";
  const COMPOSED = "\u00FC";

  it("localpart 合成后再比较，分解与合成形式视为同一 JID", () => {
    const decomposed = new JID(`${DECOMPOSED}@example.com`);
    const composed = new JID(`${COMPOSED}@example.com`);

    expect(decomposed.local).toBe(COMPOSED);
    expect(decomposed.equals(composed)).toBe(true);
  });

  it("domainpart 同样归一（IDNA2008 的 Normalization Rule 也是 NFC）", () => {
    const jid = new JID("user@e\u0301xample.com");

    expect(jid.domain).toBe("\u00E9xample.com");
    expect(jid.toString()).toBe(`user@\u00E9xample.com`);
  });

  it("resourcepart 归一但保留大小写（OpaqueString 无 Case Mapping Rule）", () => {
    const jid = new JID("user@example.com/Re\u0301sume\u0301");

    expect(jid.resource).toBe("R\u00E9sum\u00E9");
    expect(jid.toString()).toBe("user@example.com/R\u00E9sum\u00E9");
  });
});
