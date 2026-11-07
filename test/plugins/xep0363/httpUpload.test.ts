import { describe, expect, it } from "vitest";
import { Parser } from "../../../lib/ltx/Parser";
import HttpUpload, {
  type SlotRequestOptions,
} from "../../../lib/plugins/xep0363/httpUpload";

/**
 * XEP-0363: HTTP File Upload
 * @see https://xmpp.org/extensions/xep-0363.html
 * @version 1.2.0 (2025-06-17)
 *
 * 用例取自 §4 Example 3/4（slot 请求与响应）、§5（用途）与 §6（错误）。
 */
describe("HttpUpload", () => {
  describe("createRequestIqEl", () => {
    const SERVICE = "upload.montague.tld";

    /** 取出 IQ 中的 `<request/>`，便于断言其属性与子元素 */
    const createRequest = (
      filename: string,
      size: number,
      options?: SlotRequestOptions,
    ) =>
      HttpUpload.createRequestIqEl(SERVICE, filename, size, options)
        .getElementsByTagNameNS(HttpUpload.NS, "request")[0];

    it("生成发往上传服务的 IQ-get，并带上 request 子元素", () => {
      const iq = HttpUpload.createRequestIqEl(SERVICE, "hi.jpg", 23425);
      expect(iq.tagName).toBe("iq");
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe(SERVICE);
      expect(
        iq.getElementsByTagNameNS(HttpUpload.NS, "request"),
      ).toHaveLength(1);
    });

    it("§4 Example 3：生成带 filename/size/content-type 的 request", () => {
      const request = createRequest("très cool.jpg", 23456, {
        contentType: "image/jpeg",
      });
      expect(request.namespaceURI).toBe(HttpUpload.NS);
      expect(request.getAttribute("filename")).toBe("très cool.jpg");
      expect(request.getAttribute("size")).toBe("23456");
      expect(request.getAttribute("content-type")).toBe("image/jpeg");
    });

    it("§5.1 Example 6：message 用途生成 purpose 命名空间下的元素", () => {
      const request = createRequest("hi.jpg", 23425, {
        contentType: "image/jpeg",
        purpose: "message",
      });
      const purpose = request.getElementsByTagNameNS(
        HttpUpload.PURPOSE_NS,
        "message",
      )[0];
      expect(purpose).toBeTruthy();
    });

    it("未指定用途时按规范默认值生成 message 元素", () => {
      const request = createRequest("hi.jpg", 23425);
      const purposes = request.getElementsByTagNameNS(
        HttpUpload.PURPOSE_NS,
        "message",
      );
      expect(purposes).toHaveLength(1);
    });

    it("§5.3 Example 8：ephemeral 用途写入 expire-before", () => {
      const expireBefore = new Date("2025-09-10T23:08:25Z");
      const request = createRequest(
        "eiffel-tower-status-picture.jpg",
        100,
        { purpose: "ephemeral", expireBefore },
      );
      const purpose = request.getElementsByTagNameNS(
        HttpUpload.PURPOSE_NS,
        "ephemeral",
      )[0];
      expect(purpose.getAttribute("expire-before")).toBe(
        expireBefore.toISOString(),
      );
    });

    it("ephemeral 用途缺少 expireBefore 时抛错", () => {
      expect(() =>
        createRequest("a.jpg", 1, { purpose: "ephemeral" }),
      ).toThrow("必须提供 expireBefore");
    });

    it("大小不是正整数时抛错", () => {
      expect(() => createRequest("a.jpg", -1)).toThrow("必须是正整数");
      expect(() => createRequest("a.jpg", 0)).toThrow("必须是正整数");
      expect(() => createRequest("a.jpg", 1.5)).toThrow("必须是正整数");
    });
  });

  describe("parseSlot", () => {
    // §4 Example 4
    const EXAMPLE_SLOT = `
      <slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://upload.montague.tld/4a771ac1-f0b2-4a4a-9700-f2a26fa2bb67/tr%C3%A8s%20cool.jpg">
          <header name="Authorization">Basic Base64String==</header>
          <header name="Cookie">foo=bar; user=romeo</header>
        </put>
        <get url="https://download.montague.tld/4a771ac1-f0b2-4a4a-9700-f2a26fa2bb67/tr%C3%A8s%20cool.jpg" />
      </slot>`;

    it("§4 Example 4：解析 PUT/GET URL 与允许的请求头", () => {
      const slot = HttpUpload.parseSlot(Parser.parse(EXAMPLE_SLOT));
      expect(slot.put.url).toBe(
        "https://upload.montague.tld/4a771ac1-f0b2-4a4a-9700-f2a26fa2bb67/tr%C3%A8s%20cool.jpg",
      );
      expect(slot.get.url).toBe(
        "https://download.montague.tld/4a771ac1-f0b2-4a4a-9700-f2a26fa2bb67/tr%C3%A8s%20cool.jpg",
      );
      expect(slot.put.headers).toEqual([
        { name: "Authorization", value: "Basic Base64String==" },
        { name: "Cookie", value: "foo=bar; user=romeo" },
      ]);
    });

    it("过滤不允许的头、剥离换行并保留同名头的顺序", () => {
      const slot = HttpUpload.parseSlot(
        Parser.parse(`
          <slot xmlns="urn:xmpp:http:upload:0">
            <put url="https://upload.example/put">
              <header name="X-Ignored">x</header>
              <header name="Authorization">Basic
abc</header>
              <header name="Cookie">a=1</header>
              <header name="Cookie">b=2</header>
              <header name="eXpires">0</header>
            </put>
            <get url="https://download.example/get"/>
          </slot>`),
      );
      expect(slot.put.headers).toEqual([
        { name: "Authorization", value: "Basicabc" },
        { name: "Cookie", value: "a=1" },
        { name: "Cookie", value: "b=2" },
        // 规范：头名大小写不敏感，保留服务端给出的原始写法
        { name: "eXpires", value: "0" },
      ]);
    });

    it("缺少 put 或 get 的 url 时抛错", () => {
      expect(() =>
        HttpUpload.parseSlot(
          Parser.parse(
            `<slot xmlns="urn:xmpp:http:upload:0"><get url="https://d.example/x"/></slot>`,
          ),
        ),
      ).toThrow("缺少 put");

      expect(() =>
        HttpUpload.parseSlot(
          Parser.parse(
            `<slot xmlns="urn:xmpp:http:upload:0"><put url="https://u.example/x"/></slot>`,
          ),
        ),
      ).toThrow("缺少 get");
    });

    it("拒绝非 HTTPS 的 slot URL", () => {
      expect(() =>
        HttpUpload.parseSlot(
          Parser.parse(`
            <slot xmlns="urn:xmpp:http:upload:0">
              <put url="http://upload.example/put"/>
              <get url="https://download.example/get"/>
            </slot>`),
        ),
      ).toThrow("必须使用 HTTPS");
    });
  });
});
