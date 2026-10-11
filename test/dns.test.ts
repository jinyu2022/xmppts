import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * dns.ts 单元测试：mock node:dns/promises，不发起真实 SRV 查询。
 * 覆盖 RFC 2782 的 priority/weight 排序、无记录与查询失败时的空数组语义。
 */

const { resolveSrvMock } = vi.hoisted(() => ({ resolveSrvMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: {
    Resolver: class {
      resolveSrv = resolveSrvMock;
    },
  },
}));

const { resolveSrv } = await import("../lib/dns");

/** 构造一条 SRV 记录 */
function record(
  priority: number,
  weight: number,
  host: string,
  port = 5222,
) {
  return { priority, weight, name: host, port };
}

describe("resolveSrv", () => {
  afterEach(() => {
    resolveSrvMock.mockReset();
    vi.restoreAllMocks();
  });

  it("按 priority 升序输出端点，同优先级内 weight=0 的记录优先", async () => {
    resolveSrvMock.mockResolvedValue([
      record(10, 0, "c.example.com"),
      record(5, 0, "a.example.com"),
      record(10, 0, "b.example.com"),
    ]);

    await expect(resolveSrv("_xmpp-client._tcp.example.com")).resolves.toEqual([
      { host: "a.example.com", port: 5222 },
      { host: "c.example.com", port: 5222 },
      { host: "b.example.com", port: 5222 },
    ]);
  });

  it("同优先级的非零权重记录按加权随机选取，Math.random 决定顺序", async () => {
    resolveSrvMock.mockResolvedValue([
      record(5, 5, "heavy.example.com", 5223),
      record(5, 3, "light.example.com"),
    ]);

    vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(resolveSrv("_xmpp-client._tcp.example.com")).resolves.toEqual([
      { host: "heavy.example.com", port: 5223 },
      { host: "light.example.com", port: 5222 },
    ]);

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    await expect(resolveSrv("_xmpp-client._tcp.example.com")).resolves.toEqual([
      { host: "light.example.com", port: 5222 },
      { host: "heavy.example.com", port: 5223 },
    ]);
  });

  it("查询失败或没有记录时返回空数组", async () => {
    resolveSrvMock.mockResolvedValueOnce([]);
    await expect(resolveSrv("_xmpp-client._tcp.empty.example.com")).resolves.toEqual([]);

    resolveSrvMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(resolveSrv("_xmpp-client._tcp.bad.example.com")).resolves.toEqual([]);
  });

  it("只保留 host/port，不泄漏 SRV 记录的其他字段", async () => {
    resolveSrvMock.mockResolvedValue([record(0, 0, "only.example.com", 5269)]);

    const [endpoint] = await resolveSrv("_xmpp-server._tcp.example.com");
    expect(endpoint).toEqual({ host: "only.example.com", port: 5269 });
  });
});
