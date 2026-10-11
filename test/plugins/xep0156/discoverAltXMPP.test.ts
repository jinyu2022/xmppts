import { describe, it, expect, vi, afterEach } from "vitest";
import { XMPPDiscoverer } from "../../../lib/plugins/xep0156/discoverAltXMPP";

/**
 * XEP-0156: Discovering Alternative XMPP Connection Methods
 * @see https://xmpp.org/extensions/xep-0156.html
 * @version 1.4.0 (2022-02-10)
 *
 * 用例取自 §2.3 Example 1 的 host-meta 结果，用桩 fetch 返回以离线校验解析；
 * 另保留一条真实网络用例。
 */
describe("XMPPDiscoverer", () => {
  /** Example 1：/.well-known/host-meta 的 XRD 文档 */
  const EXAMPLE_1 = `<?xml version='1.0' encoding='utf-8'?>
    <XRD xmlns='http://docs.oasis-open.org/ns/xri/xrd-1.0'>
      <Link rel="urn:xmpp:alt-connections:xbosh"
            href="https://web.example.com:5280/bosh" />
      <Link rel="urn:xmpp:alt-connections:websocket"
            href="wss://web.example.com:443/ws" />
    </XRD>`;

  /** 用给定 body 桩住全局 fetch */
  function stubFetch(text: string, ok = true, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ({ ok, status, text: () => Promise.resolve(text) }) as unknown as Response)
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("Example 1：解析 xbosh 与 websocket 连接方式", async () => {
    stubFetch(EXAMPLE_1);
    const result = await XMPPDiscoverer.discoverAltXMPP("example.com");
    expect(result).toEqual({
      xbosh: "https://web.example.com:5280/bosh",
      websocket: "wss://web.example.com:443/ws",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://example.com/.well-known/host-meta");
    expect(init?.signal).toBeDefined();
  });

  it("HTTP 非 2xx 时 reject", async () => {
    stubFetch("", false, 404);
    await expect(XMPPDiscoverer.discoverAltXMPP("example.com")).rejects.toThrow("HTTP错误: 404");
  });

  it("对不可达域名 reject", async () => {
    await expect(
      XMPPDiscoverer.discoverAltXMPP("invalid-unreachable-domain.example", 500)
    ).rejects.toThrow();
  }, 10000);
});
