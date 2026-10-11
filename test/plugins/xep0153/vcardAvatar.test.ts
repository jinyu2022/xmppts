import { describe, it, expect } from "vitest";
import { XEP0153 } from "../../../lib/plugins/xep0153";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0153: vCard-Based Avatars
 * @see https://xmpp.org/extensions/xep-0153.html
 * @version 1.1.1 (2024-06-10)
 *
 * 用例取自 §3 Use Cases：Example 3（presence 携带哈希）测构造，Example 5（vCard PHOTO）
 * 测解析；无示例分支按 §4.1/§9 推导补充。
 */
describe("XEP0153", () => {
  describe("createUpdatePresence", () => {
    it("Example 3：返回带 photo 哈希的 presence XML", () => {
      const xml = XEP0153.createUpdatePresence(
        "juliet@capulet.com",
        "01b87fcd030b72895ff8e88db57ec525450f000d"
      );
      expect(xml).toBe(
        `<presence to='juliet@capulet.com'><x xmlns='${XEP0153.NS}'>` +
          `<photo>01b87fcd030b72895ff8e88db57ec525450f000d</photo></x></presence>`
      );
    });
  });

  describe("parseVCardAvatar", () => {
    it("Example 5：解析带 TYPE 与 BINVAL 的 PHOTO", () => {
      const xml = Parser.parse(`
        <vCard xmlns="vcard-temp">
          <PHOTO>
            <TYPE>image/jpeg</TYPE>
            <BINVAL>Base64-encoded-avatar-file-here!</BINVAL>
          </PHOTO>
        </vCard>
      `);
      const result = XEP0153.parseVCardAvatar(xml);
      expect(result.type).toBe("image/jpeg");
      expect(result.binval).toBe("Base64-encoded-avatar-file-here!");
    });

    it("§4.1：空 PHOTO（无头像）解析出空 binval", () => {
      const xml = Parser.parse(`<vCard xmlns="vcard-temp"><PHOTO/></vCard>`);
      expect(XEP0153.parseVCardAvatar(xml).binval).toBe("");
    });

    it("没有 PHOTO 元素时抛错", () => {
      const xml = Parser.parse(`<vCard xmlns="vcard-temp"><FN>Romeo</FN></vCard>`);
      expect(() => XEP0153.parseVCardAvatar(xml)).toThrow("没有photo标签");
    });

    it("PHOTO 不在 vcard-temp 命名空间时抛错", () => {
      const xml = Parser.parse(`<vCard xmlns="urn:invalid"><PHOTO/></vCard>`);
      expect(() => XEP0153.parseVCardAvatar(xml)).toThrow("不是vcard-temp命名空间");
    });
  });

  describe("createSetVCardAvatarIq", () => {
    it("§4.4：不传 image 时生成删除头像的 set IQ", async () => {
      const iq = await XEP0153.createSetVCardAvatarIq("juliet@capulet.com");
      const vCard = iq.getElementsByTagName("vCard")[0];
      expect(iq.getAttribute("type")).toBe("set");
      expect(iq.getAttribute("to")).toBe("juliet@capulet.com");
      expect(vCard.namespaceURI).toBe("vcard-temp");
      expect(vCard.getElementsByTagName("PHOTO")).toHaveLength(0);
    });

    it("§4.4：传入图片路径时生成带 PHOTO/TYPE/BINVAL 的 set IQ", async () => {
      const { fileURLToPath } = await import("node:url");
      const filePath = fileURLToPath(
        new URL("../xep0084/xmpp.png", import.meta.url)
      );
      const iq = await XEP0153.createSetVCardAvatarIq(
        "juliet@capulet.com",
        filePath
      );
      const photo = iq.getElementsByTagName("PHOTO")[0];
      expect(photo).toBeDefined();
      expect(photo.getElementsByTagName("TYPE")[0].textContent).toBe("image/png");
      expect(
        photo.getElementsByTagName("BINVAL")[0].textContent.length
      ).toBeGreaterThan(0);
    });
  });
});
