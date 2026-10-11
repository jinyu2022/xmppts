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

    // 2. 排序 identities
    const sortedIdentities = [...identities].sort((a, b) => {
      if (a.category !== b.category) {
        return a.category < b.category ? -1 : 1;
      }
      if (a.type !== b.type) {
        return a.type < b.type ? -1 : 1;
      }
      const langA = a.lang ?? "";
      const langB = b.lang ?? "";
      if (langA !== langB) {
        return langA < langB ? -1 : 1;
      }
      const nameA = a.name ?? "";
      const nameB = b.name ?? "";
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    // 3. 构建 identities 部分的字符串
    S += sortedIdentities
      .map(
        (id) => `${id.category}/${id.type}/${id.lang ?? ""}/${id.name ?? ""}<`,
      )
      .join("");

    // 4. 排序 features
    features.sort((a, b) => a.localeCompare(b));

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

        // 6.2. 排序并追加其他字段
        const otherFields = dataForm.fields
          .filter((field) => field.var !== "FORM_TYPE")
          .sort((a, b) => a.var!.localeCompare(b.var!));

        for (const field of otherFields) {
          S += `${field.var}<`;
          const sortedValues = [...field.values].sort();
          S += sortedValues.map((value) => `${value}<`).join("");
        }
      }
    }

    // 7. 使用 UTF-8 编码字符串 S
    const textEncoder = new TextEncoder();
    const sBuffer = textEncoder.encode(S);

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
