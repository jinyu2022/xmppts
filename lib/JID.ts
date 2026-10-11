import { XEP0106 } from "@/plugins/xep0106";
/**
 * jid = [ localpart "@" ] domainpart [ "/" resourcepart ]
 * resourcepart = 1*1023(opaquebyte)
 */
export class JID {
  /** 线上（转义）形式的 localpart，域 JID（无 localpart）时为空串 */
  readonly local: string;
  readonly domain: string;
  readonly resource?: string;
  readonly full: string;
  readonly bare: string;

  constructor(jid: string) {
    const { local, domain, resource } = JID.parse(jid);

    // XEP-0106 §4.1 第 4/5 条：发送与比较都使用转义形式
    // RFC 8265 §3.3.3 规定的顺序：Case Mapping → NFC
    this.local = (XEP0106.detect(local) ? XEP0106.escapeLocal(local) : local)
      .toLowerCase()
      .normalize("NFC");
    // RFC 7622 §3.2：domainpart 末尾的标签分隔点（"."）须在任何其他规范化步骤之前剥离
    this.domain = domain.replace(/\.$/, "").toLowerCase().normalize("NFC");
    /** resourcepart 按 OpaqueString 处理：归一但保留大小写 */
    this.resource = resource?.normalize("NFC");
    /** local 缺省（域 JID）时为空串，bare 退化为纯域名 */
    this.bare = this.local ? `${this.local}@${this.domain}` : this.domain;
    this.full = this.resource ? `${this.bare}/${this.resource}` : this.bare;
  }

  /**
   * 取 localpart
   * @param unescape 为 `true` 时返回展示形式（XEP-0106 §3.3 反转义）
   */
  getLocal(unescape = false): string {
    return unescape ? XEP0106.unescapeLocal(this.local) : this.local;
  }

  static parse(jid: string): {
    local: string;
    domain: string;
    resource?: string;
  } {
    // RFC 7622 §3.1：[ localpart "@" ] domainpart [ "/" resourcepart ]，localpart 可省略
    const jidRegex = /^(?:([^@/]+)@)?([^/@\s]+)(?:\/(.+))?$/;
    const match = jidRegex.exec(jid);
    if (!match) {
      throw new Error(`无效的 JID 格式: ${jid}`);
    }
    /** 无 localpart 的域 JID 时为空串 */
    const local = match[1] ?? "";
    const domain = match[2];
    if (!domain) {
      throw new Error(`无效的 JID 格式: ${jid}`);
    }
    const resource = match[3];

    return { local, domain, resource };
  }

  /** 支持 JID 或 JID 字符串比较；已知非 JID 对象静态推导为 false */
  equals(other: JID | string): boolean;
  equals(other: object): false;
  // 谓词承诺：true ⇒ other 为 JID 或 string，两个分支均成立
  equals(other: unknown): other is JID | string;
  equals(other: unknown): boolean {
    if (typeof other === "string") {
      return this.toString() === other;
    }
    return other instanceof JID && this.toString() === other.toString();
  }

  /**
   * 同 full
   * @param unescape 为 `true` 时 localpart 以展示形式（反转义后）输出
   */
  toString(unescape = false): string {
    if (unescape && this.local) {
      const local = this.getLocal(unescape);
      const bare = local ? `${local}@${this.domain}` : this.domain;
      return this.resource ? `${bare}/${this.resource}` : bare;
    }else {
      return this.full;
    }
  }

}
