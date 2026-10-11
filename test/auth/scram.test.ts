import { describe, expect, it } from "vitest";
import {
  arrayBufToBase64,
  generateSecureNonce,
  scramClientProof,
  scramDeriveKeys,
  scramParseChallenge,
  scramResponse,
  scramServerSign,
} from "../../lib/auth/scram";

/**
 * auth/scram.ts 单元测试：SCRAM-SHA-1 工具函数。
 * 全链路用 RFC 5802 §5 的官方示例向量验证（client proof 与 server signature 逐字节比对）。
 */
const SHA1_BITS = 160;

// RFC 5802 §5 示例
const CLIENT_FIRST_MESSAGE_BARE = "n=user,r=fyko+d2lbbFgONRv9qkxdawL";
const SERVER_FIRST_MESSAGE =
  "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096";
const CLIENT_FINAL_MESSAGE_BARE =
  "c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j";
const EXPECTED_CLIENT_PROOF = "v0X8v3Bz2T0CJGbJQyF0X+HI4Ts=";
const EXPECTED_SERVER_SIGNATURE = "rmF9pqV8S7suAoZWja4dJRkFsKQ=";

describe("scram 工具函数", () => {
  it("arrayBufToBase64 编码字节数组", () => {
    expect(arrayBufToBase64(new Uint8Array([1, 2, 3]).buffer)).toBe("AQID");
    expect(arrayBufToBase64(new Uint8Array([]).buffer)).toBe("");
  });

  it("generateSecureNonce 生成指定长度的随机 base64", () => {
    expect(atob(generateSecureNonce()).length).toBe(16);
    expect(atob(generateSecureNonce(32)).length).toBe(32);
    expect(generateSecureNonce(16)).not.toBe(generateSecureNonce(16));
  });

  it("scramDeriveKeys 按哈希位长度派生客户端与服务器密钥", async () => {
    const salt = Uint8Array.from(atob("QSXCR+Q6sek8bf92"), (c) =>
      c.charCodeAt(0),
    ).buffer;
    const { ck, sk } = await scramDeriveKeys("pencil", salt, 4096, "SHA-1", SHA1_BITS);

    expect(ck.byteLength).toBe(SHA1_BITS / 8);
    expect(sk.byteLength).toBe(SHA1_BITS / 8);
  });
});

describe("scramParseChallenge", () => {
  const SALT_B64 = btoa("pencil-salt");
  const valid = `r=nonce-abc,s=${SALT_B64},i=4096`;

  it("解析 nonce/salt/iter", () => {
    const parsed = scramParseChallenge(valid);
    expect(parsed?.nonce).toBe("nonce-abc");
    expect(parsed?.iter).toBe(4096);
    expect(new TextDecoder().decode(parsed?.salt)).toBe("pencil-salt");
  });

  it("缺少 nonce、salt 或 iter 时返回 null", () => {
    expect(scramParseChallenge("s=QSXCR+Q6sek8bf92,i=4096")).toBeNull();
    expect(scramParseChallenge("r=nonce-abc,i=4096")).toBeNull();
    expect(scramParseChallenge("r=nonce-abc,s=QSXCR+Q6sek8bf92")).toBeNull();
  });

  it("遇到强制扩展 m= 返回 null，未知可选扩展被忽略", () => {
    expect(scramParseChallenge(`${valid},m=mandatory`)).toBeNull();
    expect(scramParseChallenge(`${valid},x=optional`)?.nonce).toBe("nonce-abc");
  });

  it("迭代次数低于 4096 仍返回，不拒绝认证", () => {
    expect(scramParseChallenge("r=nonce-abc,s=QSXCR+Q6sek8bf92,i=1024")?.iter).toBe(1024);
  });
});

describe("scramResponse（RFC 5802 §5 向量）", () => {
  it("复现官方示例的客户端证明与服务器签名", async () => {
    const result = await scramResponse(
      "pencil",
      btoa(SERVER_FIRST_MESSAGE),
      CLIENT_FIRST_MESSAGE_BARE,
      "SCRAM-SHA-1",
    );

    expect(atob(result.clientResponse)).toBe(
      `${CLIENT_FINAL_MESSAGE_BARE},p=${EXPECTED_CLIENT_PROOF}`,
    );
    expect(result.serverProof).toBe(EXPECTED_SERVER_SIGNATURE);
  });

  it("服务器 nonce 不以客户端 nonce 开头时拒绝", async () => {
    await expect(
      scramResponse(
        "pencil",
        btoa("r=other-nonce,s=QSXCR+Q6sek8bf92,i=4096"),
        CLIENT_FIRST_MESSAGE_BARE,
        "SCRAM-SHA-1",
      ),
    ).rejects.toThrow("服务器 nonce 未以客户端 nonce 开头");
  });

  it("challenge 无法解析或缺少必要字段时抛错", async () => {
    await expect(
      scramResponse("pencil", btoa("r=abc"), CLIENT_FIRST_MESSAGE_BARE, "SCRAM-SHA-1"),
    ).rejects.toThrow("无法解析 SCRAM 挑战");

    await expect(
      scramResponse(
        "pencil",
        btoa(SERVER_FIRST_MESSAGE),
        "n=user,r=fyko+d2lbbFgONRv9qkxdawL",
        "SCRAM-SHA-1",
      ),
    ).resolves.toBeDefined();
  });

  it("client-first-message 不含 r= 时跳过 nonce 前缀校验", async () => {
    await expect(
      scramResponse("pencil", btoa(SERVER_FIRST_MESSAGE), "n=user", "SCRAM-SHA-1"),
    ).resolves.toBeDefined();
  });
});

describe("scramClientProof / scramServerSign", () => {
  it("与 RFC 5802 向量的中间值一致", async () => {
    const salt = Uint8Array.from(atob("QSXCR+Q6sek8bf92"), (c) =>
      c.charCodeAt(0),
    ).buffer;
    const { ck, sk } = await scramDeriveKeys("pencil", salt, 4096, "SHA-1", SHA1_BITS);
    const authMessage = [
      CLIENT_FIRST_MESSAGE_BARE,
      SERVER_FIRST_MESSAGE,
      CLIENT_FINAL_MESSAGE_BARE,
    ].join(",");

    const proof = await scramClientProof(authMessage, ck, "SHA-1");
    expect(arrayBufToBase64(proof)).toBe(EXPECTED_CLIENT_PROOF);

    const signature = await scramServerSign(authMessage, sk, "SHA-1");
    expect(arrayBufToBase64(signature)).toBe(EXPECTED_SERVER_SIGNATURE);
  });
});
