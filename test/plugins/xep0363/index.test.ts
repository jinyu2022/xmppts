import { afterEach, describe, expect, it, vi } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import type { Connection } from "../../../lib/connection";
import XEP0363 from "../../../lib/plugins/xep0363";
import HttpUpload from "../../../lib/plugins/xep0363/httpUpload";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0363 插件入口测试：确认 disco 发现、slot 请求与 HTTP PUT 流程。
 *
 * @see https://xmpp.org/extensions/xep-0363.html 1.2.0 §3/§4/§5
 */
describe("XEP0363 插件入口", () => {
  const SERVICE = "upload.capulet.lit";

  // §4 Example 3/4 的响应
  const SLOT_RESULT = `
    <iq type="result">
      <slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://upload.capulet.lit/file">
          <header name="Authorization">Basic abc</header>
        </put>
        <get url="https://download.capulet.lit/file"/>
      </slot>
    </iq>`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(options?: { service?: string }) {
    const connection = new FakeConnection();
    // 服务器把上传服务列在 disco#items 中；自动发现只对 JID 含 upload 的条目查 info
    connection.discoItems.set("capulet.lit", [
      { jid: SERVICE, name: "HTTP File Upload" },
    ]);
    connection.discoInfo.set(SERVICE, {
      identities: [{ category: "store", type: "file" }],
      features: new Set([
        HttpUpload.NS,
        `${HttpUpload.PURPOSE_NS}#message`,
        `${HttpUpload.PURPOSE_NS}#profile`,
      ]),
      extensions: {
        type: "result",
        fields: [{ var: "max-file-size", values: ["5242880"] }],
      },
    });
    connection.sendAsyncResult = Parser.parse(SLOT_RESULT);

    const plugin = new XEP0363(
      connection as unknown as Connection,
      options,
    );
    plugin.init();
    return { connection, plugin };
  }

  /** 触发 session:start 并等待自动发现的服务写入缓存 */
  async function startSession(connection: FakeConnection, plugin: XEP0363) {
    connection.emit("session:start");
    await vi.waitFor(() =>
      expect(
        (plugin as unknown as { service?: unknown }).service,
      ).not.toBeNull(),
    );
  }

  it("继承 HttpUpload 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0363(
      new FakeConnection() as unknown as Connection,
    );
    expect(plugin).toBeInstanceOf(HttpUpload);
    expect(XEP0363.dependencies).toEqual(["XEP0030"]);
  });

  it("init 不代服务端宣告 XEP-0363 特性", () => {
    const { connection } = setup();
    // 该特性表示「提供上传服务」，由上传服务在 disco#info 中宣告
    expect(connection.features.has(HttpUpload.NS)).toBe(false);
  });

  it("会话建立后自动发现并缓存上传服务", async () => {
    const { connection, plugin } = setup();
    await startSession(connection, plugin);
    expect(connection.discoInfoCalls).toContain(SERVICE);

    // 缓存命中后不再查 disco：清空假数据仍能完成上传
    connection.discoInfo.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          text: () => Promise.resolve(""),
        }),
      ),
    );

    await expect(
      plugin.upload("a.txt", new Uint8Array([1])),
    ).resolves.toBe("https://download.capulet.lit/file");
  });

  it("requestSlot 发送 IQ-get 并解析 slot", async () => {
    const { connection, plugin } = setup();

    const slot = await plugin.requestSlot(SERVICE, "très cool.jpg", 23456, {
      contentType: "image/jpeg",
    });

    expect(connection.sentAsync).toHaveLength(1);
    const iq = connection.sentAsync[0];
    expect(iq.tagName).toBe("iq");
    expect(iq.getAttribute("type")).toBe("get");
    expect(iq.getAttribute("to")).toBe(SERVICE);

    const request = iq.getElementsByTagNameNS(
      HttpUpload.NS,
      "request",
    )[0];
    expect(request.getAttribute("filename")).toBe("très cool.jpg");
    expect(request.getAttribute("size")).toBe("23456");
    expect(request.getAttribute("content-type")).toBe("image/jpeg");

    expect(slot.put.url).toBe("https://upload.capulet.lit/file");
    expect(slot.get.url).toBe("https://download.capulet.lit/file");
    expect(slot.put.headers).toEqual([
      { name: "Authorization", value: "Basic abc" },
    ]);
  });

  it("requestSlot 在服务返回 file-too-large 时抛出带上限的错误", async () => {
    const { connection, plugin } = setup();
    connection.sendAsyncResult = Parser.parse(`
      <iq type="error">
        <error type="modify">
          <not-acceptable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
          <file-too-large xmlns="urn:xmpp:http:upload:0">
            <max-file-size>20000</max-file-size>
          </file-too-large>
        </error>
      </iq>`);

    await expect(
      plugin.requestSlot(SERVICE, "très cool.jpg", 23456),
    ).rejects.toThrow("超过服务端上限 20000 字节");
  });

  it("discoverService 读取 disco#info 的 max-file-size 与用途", async () => {
    const { plugin } = setup();

    const service = (await plugin.discoverService(SERVICE))!;
    expect(service.jid).toBe(SERVICE);
    expect(service.maxFileSize).toBe(5_242_880);
    expect(service.purposes).toEqual(new Set(["message", "profile"]));
  });

  it("discoverService 可直接使用实体自身的 disco#info", async () => {
    const connection = new FakeConnection();
    connection.discoInfo.set("capulet.lit", {
      identities: [{ category: "store", type: "file" }],
      features: new Set([HttpUpload.NS]),
      extensions: {
        type: "result",
        fields: [{ var: "max-file-size", values: ["1024"] }],
      },
    });

    const plugin = new XEP0363(connection as unknown as Connection);
    plugin.init();

    const service = (await plugin.discoverService("capulet.lit"))!;
    expect(service.jid).toBe("capulet.lit");
    expect(service.maxFileSize).toBe(1024);
  });

  it("自动发现只查询 JID 含 upload 的条目", async () => {
    const { connection, plugin } = setup();
    connection.discoItems.set("capulet.lit", [
      { jid: "conference.capulet.lit" },
      { jid: SERVICE },
    ]);
    connection.emit("session:start");

    await vi.waitFor(() =>
      expect(
        (plugin as unknown as { service?: unknown }).service,
      ).not.toBeNull(),
    );
    expect(connection.discoInfoCalls).not.toContain("conference.capulet.lit");
  });

  it("配置了 service 时直接查询该服务", async () => {
    const { connection } = setup({ service: SERVICE });
    connection.emit("session:start");

    await vi.waitFor(() =>
      expect(connection.discoInfoCalls).toContain(SERVICE),
    );
    // 未回退到查询自身服务器域
    expect(connection.discoInfoCalls).not.toContain(connection.jid.domain);
  });

  it("discoverService 在实体未宣告 XEP-0363 时返回 null", async () => {
    const connection = new FakeConnection();
    connection.discoInfo.set("capulet.lit", {
      identities: [{ category: "server", type: "im" }],
      features: new Set(["http://jabber.org/protocol/disco#items"]),
    });
    const plugin = new XEP0363(connection as unknown as Connection);

    await expect(plugin.discoverService("capulet.lit")).resolves.toBeNull();
  });

  it("discoverService 在 disco#info 查询失败时返回 null", async () => {
    const connection = new FakeConnection();
    const plugin = new XEP0363(connection as unknown as Connection);

    await expect(plugin.discoverService("capulet.lit")).resolves.toBeNull();
  });

  it("upload 找不到上传服务时抛错", async () => {
    const connection = new FakeConnection();
    const plugin = new XEP0363(connection as unknown as Connection);
    plugin.init();
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      plugin.upload("a.bin", new Uint8Array([1])),
    ).rejects.toThrow("未找到支持 XEP-0363 的上传服务");
  });

  it("upload 完成 slot 请求并 PUT 到 put URL", async () => {
    const { connection, plugin } = setup();
    await startSession(connection, plugin);
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        text: () => Promise.resolve(""),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const url = await plugin.upload(
      "photo.jpg",
      new Uint8Array([1, 2, 3]),
      { contentType: "image/jpeg", signal: controller.signal },
    );

    expect(url).toBe("https://download.capulet.lit/file");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    const [putUrl, init] = calls[0];
    expect(putUrl).toBe("https://upload.capulet.lit/file");
    expect(init.method).toBe("PUT");
    expect(init.signal).toBe(controller.signal);
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("image/jpeg");
    expect(headers.get("Authorization")).toBe("Basic abc");
  });

  it("upload 在超过 max-file-size 时不发起 HTTP 请求", async () => {
    const { connection, plugin } = setup();
    connection.discoInfo.get(SERVICE)!.extensions!.fields[0].values = ["2"];
    await startSession(connection, plugin);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      plugin.upload("photo.jpg", new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("超过服务端上限 2 字节");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upload 拒绝服务未宣告的用途", async () => {
    const { connection, plugin } = setup();
    await startSession(connection, plugin);

    await expect(
      plugin.upload("a.bin", new Uint8Array([1]), { purpose: "permanent" }),
    ).rejects.toThrow("不支持 permanent 用途");
  });

  it("upload 在 HTTP 非 2xx 时抛错", async () => {
    const { connection, plugin } = setup();
    await startSession(connection, plugin);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve("denied"),
        }),
      ),
    );

    await expect(
      plugin.upload("a.bin", new Uint8Array([1])),
    ).rejects.toThrow("HTTP 403，denied");
  });
});
