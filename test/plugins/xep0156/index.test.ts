import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0156 from "../../../lib/plugins/xep0156";
import { XMPPDiscoverer } from "../../../lib/plugins/xep0156/discoverAltXMPP";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0156 插件入口测试：桩住 fetch，验证跳过分支与按 host-meta 补全连接参数。
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

function stubFetch(text: string) {
  const spy = vi.fn(
    () =>
      ({
        ok: true,
        status: 200,
        text: () => Promise.resolve(text),
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("XEP0156 插件入口", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("继承 XMPPDiscoverer", () => {
    const plugin = new XEP0156(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(XMPPDiscoverer);
  });

  it("已有 url、无 transport 或 xmpp 协议时跳过 host-meta 查询", async () => {
    const fetchSpy = stubFetch(XRD);

    const withUrl = new FakeConnection();
    withUrl.url = "wss://existing.example.com/xmpp";
    new XEP0156(withUrl as unknown as Connection).init();

    const withoutTransport = new FakeConnection();
    withoutTransport.transport = null;
    new XEP0156(withoutTransport as unknown as Connection).init();

    const xmpp = new FakeConnection();
    xmpp.protocol = "xmpp";
    new XEP0156(xmpp as unknown as Connection).init();

    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ws 协议时按发现结果补全 host/port/path/url", async () => {
    stubFetch(XRD);
    const connection = new FakeConnection();

    new XEP0156(connection as unknown as Connection).init();

    await vi.waitFor(() => expect(connection.url).toBe("wss://web.example.com:443/ws"));
    expect(connection.host).toBe("web.example.com");
    expect(connection.path).toBe("/ws");
    // 443 是 wss 的默认端口，被 URL 规范化后 port 为空串
    expect(connection.port).toBeUndefined();
  });

  it("http 协议时读取 xbosh 链接并保留显式端口", async () => {
    stubFetch(XRD);
    const connection = new FakeConnection();
    connection.protocol = "http";

    new XEP0156(connection as unknown as Connection).init();

    await vi.waitFor(() => expect(connection.url).toBe("https://web.example.com:5280/bosh"));
    expect(connection.port).toBe(5280);
    expect(connection.path).toBe("/bosh");
  });

  it("非 TLS 时把 wss 降级为 ws", async () => {
    stubFetch(XRD);
    const connection = new FakeConnection();
    connection.tls = false;

    new XEP0156(connection as unknown as Connection).init();

    // 降级只改 scheme：443 仍被 wss 的默认端口规则规范化掉
    await vi.waitFor(() => expect(connection.url).toBe("ws://web.example.com:443/ws"));
    expect(connection.port).toBeUndefined();
  });
});
