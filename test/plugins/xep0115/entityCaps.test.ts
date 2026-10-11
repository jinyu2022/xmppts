import { describe, it, expect } from "vitest";
import { EntityCaps } from "../../../lib/plugins/xep0115/entityCaps";
import { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import type { Identity } from "../../../lib/plugins/xep0030/disco";
import type { DataForm } from "../../../lib/plugins/xep0004/form";

/** 表单字段类型（form.ts 未导出 Field，取 DataForm.fields 的元素类型） */
type FormField = DataForm["fields"][number];

/**
 * XEP-0115: Entity Capabilities
 * @see https://xmpp.org/extensions/xep-0115.html
 * @version 1.6.0 (2022-03-08)
 *
 * 用例取自规范原文：presence 中的 <c/> 元素用于解析（§6.1 Example 1）；验证串生成
 * 使用 §5.2 简单示例（ver = QgayPKawpkPSDYmwT/WM94uAlu0=）与 §5.3 复杂示例
 * （ver = q07IKJEyjvHSyhy//CH0CxmKi8w=）。
 */
describe("EntityCaps", () => {
  // §6.1 Example 1：presence 中的 caps 元素
  const EXAMPLE_1_PRESENCE = `
    <presence>
      <c xmlns='http://jabber.org/protocol/caps'
         hash='sha-1'
         node='http://code.google.com/p/exodus'
         ver='QgayPKawpkPSDYmwT/WM94uAlu0='/>
    </presence>`;

  describe("parseCaps", () => {
    it("Example 1：解析合法的 caps 元素", () => {
      const el = Parser.parse(EXAMPLE_1_PRESENCE).getElementsByTagName("c")[0];
      const result = EntityCaps.parseCaps(el);
      expect(result.cap.node).toBe("http://code.google.com/p/exodus");
      expect(result.cap.ver).toBe("QgayPKawpkPSDYmwT/WM94uAlu0=");
      expect(result.cap.hash).toBe("sha-1");
    });

    it("命名空间非法时抛错", () => {
      const el = XMPPElement.createElementNS("urn:invalid", "c");
      el.setAttribute("node", "http://example.com/myapp");
      el.setAttribute("ver", "1.0");
      el.setAttribute("hash", "sha-1");
      expect(() => EntityCaps.parseCaps(el)).toThrow();
    });
  });

  describe("generateCapsVerification", () => {
    // §5.2 简单示例：单一 identity + 四个 feature
    const SIMPLE_IDENTITIES: Identity[] = [
      { category: "client", type: "pc", name: "Exodus 0.9.1" },
    ];
    const SIMPLE_FEATURES = [
      "http://jabber.org/protocol/disco#info",
      "http://jabber.org/protocol/disco#items",
      "http://jabber.org/protocol/caps",
      "http://jabber.org/protocol/muc",
    ];

    it("Example（§5.2）：生成与规范一致的 SHA-1 验证串", async () => {
      const ver = await EntityCaps.generateCapsVerification(
        SIMPLE_IDENTITIES,
        [...SIMPLE_FEATURES],
      );
      expect(ver).toBe("QgayPKawpkPSDYmwT/WM94uAlu0=");
    });

    it("Example（§5.3）：携带多语言 identity 与 dataForm 的复杂验证串", async () => {
      const identities: Identity[] = [
        { category: "client", type: "pc", name: "Psi 0.11", lang: "en" },
        { category: "client", type: "pc", name: "Ψ 0.11", lang: "el" },
      ];
      const fields = [
        ["ip_version", ["ipv4", "ipv6"]],
        ["os", ["Mac"]],
        ["os_version", ["10.5.1"]],
        ["software", ["Psi"]],
        ["software_version", ["0.11"]],
      ].map(
        ([varName, values]) =>
          ({ var: varName, type: "text-single", values }) as FormField,
      );
      const dataForm: DataForm = {
        type: "result",
        fields: [
          { var: "FORM_TYPE", type: "hidden", values: ["urn:xmpp:dataforms:softwareinfo"] },
          ...fields,
        ],
      };

      const ver = await EntityCaps.generateCapsVerification(
        identities,
        [...SIMPLE_FEATURES],
        dataForm,
      );
      expect(ver).toBe("q07IKJEyjvHSyhy//CH0CxmKi8w=");
    });

    it("相同输入结果一致（§5.1 Generation Method）", async () => {
      const r1 = await EntityCaps.generateCapsVerification(SIMPLE_IDENTITIES, [
        ...SIMPLE_FEATURES,
      ]);
      const r2 = await EntityCaps.generateCapsVerification(SIMPLE_IDENTITIES, [
        ...SIMPLE_FEATURES,
      ]);
      expect(r1).toBe(r2);
    });

    it("先按 category、type、lang、name 排序 identity", async () => {
      const identities: Identity[] = [
        { category: "server", type: "im" },
        { category: "client", type: "pc", name: "Alpha" },
        { category: "client", type: "bot" },
      ];
      const ver = await EntityCaps.generateCapsVerification(identities, []);
      expect(typeof ver).toBe("string");
    });
  });

  describe("createCapsElement", () => {
    it("Example 1：用 node、ver、hash 创建 caps 元素", () => {
      const el = EntityCaps.createCapsElement({
        node: "http://code.google.com/p/exodus",
        ver: "QgayPKawpkPSDYmwT/WM94uAlu0=",
        hash: "sha-1",
      });
      expect(el.tagName).toBe("c");
      expect(el.namespaceURI).toBe(EntityCaps.NS);
      expect(el.getAttribute("node")).toBe("http://code.google.com/p/exodus");
      expect(el.getAttribute("ver")).toBe("QgayPKawpkPSDYmwT/WM94uAlu0=");
      expect(el.getAttribute("hash")).toBe("sha-1");
    });

    it("从解析结果创建元素", () => {
      const orig = Parser.parse(EXAMPLE_1_PRESENCE).getElementsByTagName("c")[0];
      const el = EntityCaps.createCapsElement(EntityCaps.parseCaps(orig).cap);
      expect(el.getAttribute("node")).toBe("http://code.google.com/p/exodus");
      expect(el.getAttribute("ver")).toBe("QgayPKawpkPSDYmwT/WM94uAlu0=");
      expect(el.getAttribute("hash")).toBe("sha-1");
    });
  });
});
