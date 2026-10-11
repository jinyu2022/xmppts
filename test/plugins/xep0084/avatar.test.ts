import { describe, it, expect } from "vitest";
import { Avatar } from "../../../lib/plugins/xep0084/avatar";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0084: User Avatar
 * @see https://xmpp.org/extensions/xep-0084.html
 * @version 1.1.5 (2026-08-23)
 *
 * 用例取自规范示例：Example 3（发布元数据）与 Example 6（按 ItemID 取数据）测解析/构造，
 * Example 1/7 的 data 元素作为补充；无示例分支按 §11 XML Schema 推导。
 */
describe("Avatar", () => {
  const ID = "111f4b3c50d7b0df729d299bc6f8e9ef9066971f";

  describe("parseMetadataEl", () => {
    it("Example 3：解析 metadata 中的 info", () => {
      const xml = Parser.parse(`
        <metadata xmlns="urn:xmpp:avatar:metadata">
          <info bytes="12345" id="${ID}" height="64" type="image/png" width="64"/>
        </metadata>
      `);
      expect(Avatar.parseMetadataEl(xml)).toEqual({
        metadata: { id: ID, type: "image/png", bytes: 12345, width: 64, height: 64 },
      });
    });

    it("Example 4：解析带 url 的 info", () => {
      const xml = Parser.parse(`
        <metadata xmlns="urn:xmpp:avatar:metadata">
          <info bytes="23456" height="64" id="357a8123a30844a3aa99861b6349264ba67a5694"
                type="image/gif" url="http://avatars.example.org/happy.gif" width="64"/>
        </metadata>
      `);
      const md = Avatar.parseMetadataEl(xml).metadata!;
      expect(md.type).toBe("image/gif");
      expect(md.url).toBe("http://avatars.example.org/happy.gif");
      expect(md.width).toBe(64);
    });

    it("Example 8：空 metadata（禁用头像）返回 { metadata: null }", () => {
      const xml = Parser.parse(`<metadata xmlns="urn:xmpp:avatar:metadata"/>`);
      expect(Avatar.parseMetadataEl(xml)).toEqual({ metadata: null });
    });
  });

  describe("createRetrieveDataIq", () => {
    it("Example 6：生成按 ItemID 取头像数据的 get IQ", () => {
      const iq = Avatar.createRetrieveDataIq("juliet@capulet.lit", ID);
      expect(iq.getAttribute("type")).toBe("get");
      expect(iq.getAttribute("to")).toBe("juliet@capulet.lit");
      const items = iq.getElementsByTagName("items")[0];
      expect(items.getAttribute("node")).toBe(Avatar.NS.data);
      // Example 6 只带 ItemID，无 max_items
      expect(items.getAttribute("max_items")).toBeNull();
      expect(items.getElementsByTagName("item")[0].getAttribute("id")).toBe(ID);
    });
  });

  describe("imageParser", () => {
    const id = "b85aee85ddb23a4c1111c7d43ba6ab9afd76c552";

    it("§3.1：metadata.id 为图片数据的 SHA-1", async () => {
      const { fileURLToPath } = await import("node:url");
      const filePath = fileURLToPath(new URL("./xmpp.png", import.meta.url));

      const { base64Data, metadata } = await Avatar.imageParser(filePath);

      expect(metadata.id).toBe(id);
      expect(metadata.type).toBe("image/png");
      expect(base64Data.length).toBeGreaterThan(0);
    });
  });
});
