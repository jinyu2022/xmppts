import { arrayBufToBase64 } from "@/auth/scram";
import { XMPPElement } from "@/ltx/Element";
import type { Identity } from "../xep0030/disco";
import type { DataForm } from "../xep0004/form";

export interface Capabilities {
  node: string;
  ver: string;
  hash: string;
}

/**
 * XEP-0115: Entity Capabilities 实体能力
 * @see https://xmpp.org/extensions/xep-0115.html
 * @version 1.6.0 (2022-03-08)
 */
export class EntityCaps {
  static readonly NS = "http://jabber.org/protocol/caps" as const;

  /** 所有排序（i;octet）与最终 `encode(S)` 共用的 UTF-8 编码器 */
  private static readonly textEncoder = new TextEncoder();

  /**
   * XEP-0115 §5.1 规定：验证串生成过程中的**所有**排序 MUST 使用
   * "i;octet" collation（RFC 4790 §9.3），即按 UTF-8 编码逐字节比较。不能替换成：
   * - `localeCompare`：CLDR 语言排序，标点/数字/大小写的相对权重与字节值无关
   *   （如 "foo:1" 会排在 "foo0" 前，而 ':'(58) > '0'(48)）；
   * - `<` / 默认 `sort()`：比较的是 UTF-16 码元，非 BMP 字符（代理对）会排错。
   */
  private static compareOctets(a: string, b: string): number {
    // 与规范字面一致：先编码成 UTF-8，再逐字节比较
    const ba = EntityCaps.textEncoder.encode(a);
    const bb = EntityCaps.textEncoder.encode(b);
    const length = Math.min(ba.length, bb.length);
    for (let i = 0; i < length; i++) {
      if (ba[i] !== bb[i]) return ba[i] - bb[i];
    }
    // 前缀关系：短串在前
    return ba.length - bb.length;
  }

  static parseCaps(caps: XMPPElement): { cap: Capabilities } {
    if (caps.namespaceURI !== EntityCaps.NS)
      throw new Error(`不是实体能力命名空间: ${caps.toXMLString()}`);
    const node = caps.getAttribute("node")!;
    const ver = caps.getAttribute("ver")!;
    const hash = caps.getAttribute("hash")!;
    return {
      cap: { node, ver, hash },
    };
  }

  /**
   * 根据 XEP-0115 规范生成 Capabilities 验证字符串的 SHA-1 Base64 编码值
   * @param identities 身份信息数组
   * @param features 功能特性 Set 集合
   * @param dataForm 数据表单
   * @returns SHA-1 Base64 编码的验证字符串
   */
  static async generateCapsVerification(
    identities: Identity[],
    features: Array<string>,
    dataForm?: DataForm,
  ): Promise<string> {
    // 1. 初始化空字符串 S
    let S = "";

    // 2. 排序 identities（§5.1 第 2 步：category → type → xml:lang，均用 i;octet）
    const sortedIdentities = [...identities].sort(
      (a, b) =>
        EntityCaps.compareOctets(a.category, b.category) ||
        EntityCaps.compareOctets(a.type, b.type) ||
        EntityCaps.compareOctets(a.lang ?? "", b.lang ?? "") ||
        EntityCaps.compareOctets(a.name ?? "", b.name ?? ""),
    );

    // 3. 构建 identities 部分的字符串
    S += sortedIdentities
      .map(
        (id) => `${id.category}/${id.type}/${id.lang ?? ""}/${id.name ?? ""}<`,
      )
      .join("");

    // 4. 排序 features（§5.1 第 4 步；i;octet）
    features.sort(EntityCaps.compareOctets);

    // 5. 构建 features 部分的字符串
    S += features.map((feature) => `${feature}<`).join("");

    // 6. 处理扩展数据表单
    if (dataForm?.fields) {
      // 6.1. 查找并追加 FORM_TYPE
      const formTypeField = dataForm.fields.find(
        (field) => field.var === "FORM_TYPE",
      );
      if (formTypeField && formTypeField.values.length > 0) {
        S += `${formTypeField.values[0]}<`;

        // 6.2. 排序并追加其他字段（§5.1 第 7-b 步：按 var 属性值排序，i;octet）
        const otherFields = dataForm.fields
          .filter((field) => field.var !== "FORM_TYPE")
          .sort((a, b) => EntityCaps.compareOctets(a.var!, b.var!));

        for (const field of otherFields) {
          S += `${field.var}<`;
          // §5.1 第 7-c 步：值按 XML character data 排序，i;octet
          const sortedValues = [...field.values].sort(EntityCaps.compareOctets);
          S += sortedValues.map((value) => `${value}<`).join("");
        }
      }
    }

    // 7. 使用 UTF-8 编码字符串 S（复用比较用的编码器）
    const sBuffer = EntityCaps.textEncoder.encode(S);

    // 8. 计算 SHA-1 哈希值
    const hashBuffer = await crypto.subtle.digest("SHA-1", sBuffer);

    // 9. 将哈希值转换为 Base64 编码
    return arrayBufToBase64(hashBuffer);
  }

  static createCapsElement(caps: Capabilities) {
    const c = XMPPElement.createElementNS(EntityCaps.NS, "c", {
      hash: caps.hash,
      ver: caps.ver,
      node: caps.node,
    });
    return c;
  }
}
