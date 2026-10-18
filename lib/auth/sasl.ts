import { XMPPElement } from "@/ltx";
import { JID } from "@/JID";
import { scramResponse, generateSecureNonce } from "./scram";

/** SASL 认证命名空间 (RFC 6120 §6) */
export const SASL_NS = "urn:ietf:params:xml:ns:xmpp-sasl";

/**
 * SASL 机制优先级：靠前的优先选择。
 * SCRAM-SHA-1 优先于 PLAIN，因为 PLAIN 会以可还原的明文口令传输。
 */
const SASL_MECHANISMS = ["SCRAM-SHA-1", "PLAIN"] as const;

/** 支持的 SASL 认证机制类型 */
type SaslMechanism = (typeof SASL_MECHANISMS)[number];

/** SASL 状态机中间数据（仅认证期间使用） */
interface SaslData {
  /** 已选定的机制；start() 之前为空 */
  mechanism?: SaslMechanism;
  /** SCRAM 首条消息（不含 gs2-header），计算 client-final 时需要 */
  clientFirstMessageBare?: string;
  /** 本地推导的服务端签名，用于校验 success 中的 v= */
  serverProof?: string;
}

/** 已解析的服务器 SASL 事件（RFC 6120 §6.4） */
export type SaslEvent =
  /** payload 为 Base64 编码的 SASL 数据 */
  | { type: "challenge"; payload: string }
  /** SCRAM 下 payload 为 "v=..." 形式的服务器签名 */
  | { type: "success"; payload: string }
  /** condition 为失败条件名，如 not-authorized */
  | { type: "failure"; condition: string };

/** SASL 步骤处理结果 */
type SaslResult =
  /** 需发送 data（已序列化为 XML）后等待服务器下一节 */
  | { type: "send"; data: string }
  /** 认证完成 */
  | { type: "success" };

/** SASL 认证失败（RFC 6120 §6.5.2），携带机器可读的条件名供状态判定。 */
export class SaslError extends Error {
  /** SASL 失败条件，如 not-authorized */
  readonly condition: string;

  constructor(condition: string) {
    super(`认证失败: ${condition}`);
    this.name = "SaslError";
    this.condition = condition;
  }
}

/**
 * 将 UTF-8 字符串编码为 Base64。
 * TextEncoder → 按 code point 转二进制字符串 → btoa。
 */
export function utf8ToBase64(text: string): string {
  // TextEncoder 将 JS 字符串转为 UTF-8 字节序列
  const bytes = new TextEncoder().encode(text);
  // 将每个字节转为对应 code point 的字符，拼接成二进制字符串
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

/**
 * 解析 SASL 挑战/响应中的逗号分隔属性对。
 * e.g. "v=MEUCIQ...=,r=fyko+d2lbbFgONR..." → { v: "...", r: "..." }
 */
export function parseSaslAttributes(
  payload: string,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const part of payload.split(",")) {
    const separator = part.indexOf("=");
    // 跳过没有 '=' 或 key 为空的部分
    if (separator <= 0) continue;
    attributes[part.slice(0, separator)] = part.slice(separator + 1);
  }
  return attributes;
}

/**
 * 构建 SASL `<auth/>` 或 `<response/>` XML。
 *
 * @param localName `auth` 用于首条消息，`response` 用于挑战应答
 * @param payload Base64 编码的 SASL 载荷，作为元素文本
 * @param attrs 额外属性（如 `mechanism`）
 */
function buildSaslXml(
  localName: "auth" | "response",
  payload: string,
  attrs?: Record<string, string>,
): string {
  const element = XMPPElement.createElementNS(SASL_NS, localName, attrs);
  element.textContent = payload;
  return element.toXMLString();
}

/**
 * TCP 与 WebSocket 共用的 SASL 客户端计算器。
 *
 * 纯计算无网络副作用：根据服务器宣告的机制名列表选择最优认证机制，
 * 计算并返回认证响应的 XML 序列化结果，供调用者发送到服务器。
 * 解析服务器节的职责在传输层。
 */
export class SaslClient {
  private state: SaslData = {};

  constructor(private readonly jid: JID) {}

  /** 当前使用的 SASL 机制，在调用 start() 后可用。 */
  get mechanism(): SaslData["mechanism"] {
    return this.state.mechanism;
  }

  /** 清除上一次认证的中间状态；重连会重新协商机制，旧状态不能复用 */
  reset(): void {
    this.state = {};
  }

  /**
   * 启动 SASL 认证：选择机制并生成初始认证响应。
   *
   * - PLAIN：直接发送用户名+密码的 Base64 编码。
   * - SCRAM-SHA-1：发送 client-first-message-bare（省略 gs2-header）。
   *
   * @param mechanisms - 服务器宣告的机制名列表。
   * @param password - 明文密码，仅本调用期间使用，不驻留实例。
   * @returns 要发送给服务器的 XML 字符串。
   */
  start(mechanisms: readonly string[], password: string): string {
    // 按优先级取第一个服务器宣告的机制
    const mechanism = SASL_MECHANISMS.find((candidate) =>
      mechanisms.includes(candidate),
    );
    if (!mechanism) throw new Error("不受支持的认证机制");
    this.state.mechanism = mechanism;

    if (mechanism === "PLAIN") {
      // PLAIN 格式: \0username\0password
      const plain = `\0${this.jid.local}\0${password}`;
      return buildSaslXml("auth", utf8ToBase64(plain), { mechanism });
    }

    // SCRAM-SHA-1: 构造 client-first-message-bare (n=用户名,r=随机nonce)
    // RFC 5802 §5.1：用户名中的 = 与 , 需转义，否则服务端按属性分隔符解析会截断
    const username = this.jid.local.replace(/=/g, "=3D").replace(/,/g, "=2C");
    this.state.clientFirstMessageBare = `n=${username},r=${generateSecureNonce()}`;
    // 完整 client-first-message 包含 gs2-header (n,,) + client-first-message-bare
    return buildSaslXml(
      "auth",
      utf8ToBase64(`n,,${this.state.clientFirstMessageBare}`),
      { mechanism },
    );
  }

  /**
   * 处理服务器已解析的 SASL 事件。
   *
   * - PLAIN：一次性认证，只需判断 success/failure。
   * - SCRAM-SHA-1：多轮交互，收到 challenge 后计算响应。
   *
   * @param event - 由传输层从服务器 SASL 节解析出的协议事件。
   * @param password - 明文密码，仅本调用期间使用，不驻留实例。
   * @returns 下一步行动：send（需回复 XML）/ success。
   * @throws {SaslError} 收到 failure 事件时。
   * @throws {Error} 尚未 start()、收到与当前机制不符的节，或 SCRAM 数据不合法时。
   */
  async process(event: SaslEvent, password: string): Promise<SaslResult> {
    // 生命周期守卫：必须先 start() 选定机制
    const mechanism = this.state.mechanism;
    if (!mechanism) {
      throw new Error("SaslClient 尚未 start，无法处理 SASL 事件");
    }

    // failure 与当前机制无关，任何阶段收到都立即终止认证
    if (event.type === "failure") {
      throw new SaslError(event.condition);
    }

    // PLAIN 只有一轮交互（RFC 6120 §6.4.2）：服务器不应再发 challenge
    if (mechanism === "PLAIN") {
      if (event.type !== "success") {
        throw new Error(`PLAIN 认证收到意外的 ${event.type} 节`);
      }
      return { type: "success" };
    }

    // 至此机制必为 SCRAM-SHA-1（守卫已排除未选机制，PLAIN 已在上方返回）
    // SCRAM-SHA-1: 处理服务器的 challenge
    if (event.type === "challenge") {
      // challenge 载荷是 Base64 编码的 server-first-message
      if (!event.payload) throw new Error("空的 SCRAM challenge");

      // client-first-message-bare 由 start() 的 SCRAM 分支写入
      const clientFirstMessageBare = this.state.clientFirstMessageBare;
      if (!clientFirstMessageBare) {
        throw new Error("SCRAM 状态缺失：未发送 client-first-message");
      }
      // 计算 client-final-message + 缓存 server-proof 用于最终验证
      const { clientResponse, serverProof } = await scramResponse(
        password,
        event.payload,
        clientFirstMessageBare,
        mechanism,
      );
      this.state.serverProof = serverProof;
      return { type: "send", data: buildSaslXml("response", clientResponse) };
    }

    // SCRAM-SHA-1: success 必须校验服务器签名后才算认证成功
    this.verifyScramSuccess(event.payload);
    return { type: "success" };
  }

  /**
   * 验证 SCRAM 服务器的最终签名。
   * 从 success 载荷的 Base64 解码后提取 v= 属性值，与本地计算的 serverProof 对比。
   *
   * @param payload success 节的文本载荷（未解码的 Base64）
   */
  private verifyScramSuccess(payload: string): void {
    // 本地签名只在处理过 challenge 后才有（RFC 5802 §5.1），缺失说明服务器跳过了 challenge
    const expected = this.state.serverProof;
    if (!expected) {
      throw new Error("SCRAM 协议错误：未收到 challenge 就收到 success");
    }
    if (!payload) throw new Error("无法解析服务器签名：空 success 载荷");

    // success 载荷是 Base64 编码的 "v=签名,r=nonce" 属性串
    let decoded: string;
    try {
      decoded = atob(payload);
    } catch {
      throw new Error("无法解析服务器签名：非法 Base64");
    }

    // SASL 属性格式：v=base64signature,r=...,p=...
    const signature = parseSaslAttributes(decoded).v;
    if (!signature) throw new Error("无法解析服务器签名：缺少 v=");
    // 验证服务器签名与本地计算结果一致，防止中间人篡改
    if (signature !== expected) {
      throw new Error("服务器签名不匹配");
    }
  }
}
