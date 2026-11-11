import { describe, it, expect, vi } from "vitest";
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

    it("非 metadata 命名空间抛错，可选属性缺省为 undefined", () => {
      expect(() =>
        Avatar.parseMetadataEl(Parser.parse(`<metadata xmlns="urn:example:other"/>`)),
      ).toThrow("不是一个metadata元素");

      const xml = Parser.parse(`
        <metadata xmlns="${Avatar.NS.metadata}">
          <info bytes="1" id="x" type="image/png"/>
        </metadata>
      `);
      expect(Avatar.parseMetadataEl(xml)).toEqual({
        metadata: {
          id: "x",
          type: "image/png",
          bytes: 1,
          width: undefined,
          height: undefined,
          url: undefined,
        },
      });
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

    it("既非路径也非 File 时抛错", async () => {
      await expect(
        Avatar.imageParser(123 as unknown as string),
      ).rejects.toThrow("不支持的图片类型");
    });

    it("浏览器分支：File 经 FileReader 读取并计算 SHA-1 与尺寸", async () => {
      class FakeFileReader {
        result = "";
        onload?: () => void;
        readAsDataURL(file: File) {
          this.result = `data:${file.type};base64,${Buffer.from("fake").toString("base64")}`;
          this.onload?.();
        }
      }
      class FakeImage {
        width = 32;
        height = 24;
        onload?: () => void;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      }

      const revokeObjectURL = vi.fn();
      vi.stubGlobal("window", {});
      vi.stubGlobal("FileReader", FakeFileReader);
      vi.stubGlobal("Image", FakeImage);
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: () => "blob:fake",
        revokeObjectURL,
      });

      try {
        const file = new File([new Uint8Array([1, 2, 3])], "a.png", {
          type: "image/png",
        });
        const { base64Data, metadata } = await Avatar.imageParser(file);

        expect(base64Data).toBe(Buffer.from("fake").toString("base64"));
        expect(metadata.type).toBe("image/png");
        expect(metadata.bytes).toBe(3);
        expect(metadata.width).toBe(32);
        expect(metadata.height).toBe(24);
        expect(metadata.id).toMatch(/^[0-9a-f]{40}$/);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("浏览器分支：FileReader 失败时 reject，不再永久挂起", async () => {
      class FakeFileReader {
        result = "";
        error = new Error("read failed");
        onload?: () => void;
        onerror?: () => void;
        readAsDataURL(_file: File) {
          queueMicrotask(() => this.onerror?.());
        }
      }

      vi.stubGlobal("window", {});
      vi.stubGlobal("FileReader", FakeFileReader);

      try {
        const file = new File([new Uint8Array([1])], "a.png", {
          type: "image/png",
        });
        await expect(Avatar.imageParser(file)).rejects.toThrow("read failed");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("浏览器分支：Image 加载失败时 reject 并释放 object URL", async () => {
      class FakeFileReader {
        result = "";
        onload?: () => void;
        readAsDataURL(file: File) {
          this.result = `data:${file.type};base64,${Buffer.from("fake").toString("base64")}`;
          this.onload?.();
        }
      }
      class FakeImage {
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
      const revokeObjectURL = vi.fn();

      vi.stubGlobal("window", {});
      vi.stubGlobal("FileReader", FakeFileReader);
      vi.stubGlobal("Image", FakeImage);
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: () => "blob:fake",
        revokeObjectURL,
      });

      try {
        const file = new File([new Uint8Array([1])], "a.png", {
          type: "image/png",
        });
        await expect(Avatar.imageParser(file)).rejects.toThrow("加载图片失败");
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("nodeImageParser：不支持的图片类型抛错", async () => {
      vi.resetModules();
      vi.doMock("image-size", () => ({
        imageSize: () => ({ type: "bmp", width: 1, height: 1 }),
      }));
      const { fileURLToPath } = await import("node:url");
      const filePath = fileURLToPath(new URL("./xmpp.png", import.meta.url));

      try {
        await expect(Avatar.imageParser(filePath)).rejects.toThrow(
          "不支持的图片类型: bmp",
        );
      } finally {
        vi.doUnmock("image-size");
      }
    });
  });

  describe("createDataPublishIq", () => {
    it("png：生成 data 与 metadata 两条发布 IQ（Example 1/3）", async () => {
      const { fileURLToPath } = await import("node:url");
      const filePath = fileURLToPath(new URL("./xmpp.png", import.meta.url));

      const [dataIq, metadataIq] = await Avatar.createDataPublishIq(filePath);

      const dataPublish = dataIq.getElementsByTagName("publish")[0];
      expect(dataPublish.getAttribute("node")).toBe(Avatar.NS.data);
      expect(dataIq.getElementsByTagNameNS(Avatar.NS.data, "data")).toHaveLength(1);

      const metadataPublish = metadataIq.getElementsByTagName("publish")[0];
      expect(metadataPublish.getAttribute("node")).toBe(Avatar.NS.metadata);
      const info = metadataIq.getElementsByTagNameNS(Avatar.NS.metadata, "info")[0];
      expect(info.getAttribute("type")).toBe("image/png");
    });

    it("非 png 拒绝发布", async () => {
      class FakeFileReader {
        result = "";
        onload?: () => void;
        readAsDataURL(file: File) {
          this.result = `data:${file.type};base64,${Buffer.from("fake").toString("base64")}`;
          this.onload?.();
        }
      }
      class FakeImage {
        width = 1;
        height = 1;
        onload?: () => void;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      }

      vi.stubGlobal("window", {});
      vi.stubGlobal("FileReader", FakeFileReader);
      vi.stubGlobal("Image", FakeImage);
      vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake" });

      try {
        const file = new File([new Uint8Array([1])], "a.gif", {
          type: "image/gif",
        });
        await expect(Avatar.createDataPublishIq(file)).rejects.toThrow(
          "只支持png格式的图片",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
