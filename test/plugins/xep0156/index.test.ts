import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0156 from "../../../lib/plugins/xep0156";

/**
 * XEP-0156 静态工具测试：桩住 fetch，验证 host-meta 解析与端点推导。
 *
 * @see https://xmpp.org/extensions/xep-0156.html 1.4.0 §2.3 Examples（Example 1）
 */
const XRD = `<?xml version='1.0' encoding='utf-8'?>
  <XRD xmlns='http://docs.oasis-open.org/ns/xri/xrd-1.0'>
    <Link rel="urn:xmpp:alt-connections:xbosh"
          href="https://web.example.com:5280/bosh" />
    <Link rel="urn:xmpp:alt-connections:websocket"
          href="wss://web.example.com:443/ws" />
  </XRD>`;

function stubFetch(text: string, ok = true, status = 200) {
  const spy = vi.fn(
    () =>
      ({
        ok,
        status,
        text: () => Promise.resolve(text),
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("XEP0156 静态工具", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("不再实现插件接口", () => {
    expect("init" in XEP0156.prototype).toBe(false);
  });

  it("discoverAltXMPP 解析 xbosh 与 websocket 连接方式", async () => {
    stubFetch(XRD);

    const result = await XEP0156.discoverAltXMPP("capulet.lit");

    expect(result).toEqual({
      xbosh: "https://web.example.com:5280/bosh",
      websocket: "wss://web.example.com:443/ws",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://capulet.lit/.well-known/host-meta");
    expect(init?.signal).toBeDefined();
  });

  it("HTTP 非 2xx 时 reject", async () => {
    stubFetch("", false, 404);

    await expect(XEP0156.discoverAltXMPP("capulet.lit")).rejects.toThrow(
      "HTTP错误: 404",
    );
  });

  it("对不可达域名 reject", async () => {
    await expect(
      XEP0156.discoverAltXMPP("invalid-unreachable-domain.example", 500),
    ).rejects.toThrow();
  }, 10000);

  it("resolveEndpoint 解析 host/path，缺省端口交由传输决定", async () => {
    stubFetch(XRD);

    // 公布地址的 :443 被 URL 归一化去掉，本工具不再补 scheme 默认端口
    await expect(XEP0156.resolveEndpoint("capulet.lit")).resolves.toEqual({
      host: "web.example.com",
      port: undefined,
      path: "/ws",
    });
  });

  it("未公布 websocket 连接方式时抛错", async () => {
    stubFetch(`<?xml version='1.0' encoding='utf-8'?>
      <XRD xmlns='http://docs.oasis-open.org/ns/xri/xrd-1.0'/>`);

    await expect(XEP0156.resolveEndpoint("capulet.lit")).rejects.toThrow(
      "未找到 websocket 连接方法",
    );
  });

  it("IPv6 主机去掉方括号", async () => {
    stubFetch(`<XRD xmlns='http://docs.oasis-open.org/ns/xri/xrd-1.0'>
        <Link rel="urn:xmpp:alt-connections:websocket"
              href="wss://[2001:db8::1]/ws" />
      </XRD>`);

    // 公布地址未写端口时返回 undefined，缺省端口由传输按最终 scheme 决定
    await expect(XEP0156.resolveEndpoint("capulet.lit")).resolves.toEqual({
      host: "2001:db8::1",
      port: undefined,
      path: "/ws",
    });
  });
});
