import { EntityCaps, type Capabilities } from "@/plugins/xep0115/entityCaps";
import { XMPPElement } from "@/ltx";
import { JID } from "@/JID";
import { scramResponse, generateSecureNonce } from "@/auth/scram";
import type { SaslData } from "./typing";

/** SASL 认证命名空间 (RFC 6120 §6) */
const SASL_NS = "urn:ietf:params:xml:ns:xmpp-sasl";
/** 资源绑定命名空间 (RFC 6120 §7) */
const BIND_NS = "urn:ietf:params:xml:ns:xmpp-bind";
// NOSONAR: RFC 6120 固定的 XML 命名空间标识符，不是网络请求地址。
const STREAM_NS = "http://etherx.jabber.org/streams";
const STREAM_ERROR_NS = "urn:ietf:params:xml:ns:xmpp-streams";

/** 各 SASL 机制的安全等级，值越高越安全，用于自动选择最优机制。 */
const SECURITY_LEVELS = {
  PLAIN: 2,
  "SCRAM-SHA-1": 3,
} as const;

/** 支持的 SASL 认证机制类型。 */
type SaslMechanism = keyof typeof SECURITY_LEVELS;

/** 流功能宣告解析结果。 */
interface StreamFeatures {
  /** 服务器支持的所有命名空间集合。 */
  namespaces: Set<string>;
  /** 可选的实体能力 (XEP-0115)。 */
  entityCaps?: Capabilities;
}

/** 资源绑定请求，包含唯一 ID 和 XML 序列化数据。 */
interface BindRequest {
  id: string;
  data: string;
}

/** SASL 步骤处理结果。 */
type SaslResult =
  | { type: "send"; data: string }
  | { type: "success" }
  | { type: "ignore" };

/**
 * 判断 stanza 是否为流功能宣告 (<features> / <stream:features>)。
 * 前缀可有可无，命名空间才是语义（RFC 6120 §4.3.2）。
 */
export function isStreamFeatures(stanza: XMPPElement): boolean {
  return (
    stanza.localName === "features" && stanza.namespaceURI === STREAM_NS
  );
}

/**
 * 判断 stanza 是否为流错误 (<error> / <stream:error>)。
 * 前缀可有可无，命名空间才是语义（RFC 6120 §4.9）。
 */
export function isStreamError(stanza: XMPPElement): boolean {
  return stanza.localName === "error" && stanza.namespaceURI === STREAM_NS;
}

/**
 * 从服务器宣告的流功能中选择最优 SASL 认证机制。
 * 按安全等级降序排列，优先选择 SCRAM-SHA-1。
 *
 * @throws 当无支持的认证机制时抛出。
 */
export function selectSaslMechanism(
  features: XMPPElement,
): SaslMechanism {
  // 提取服务器支持且在 SECURITY_LEVELS 白名单中的机制，按安全等级降序
  const supported = Array.from(features.getElementsByTagName("mechanism"))
    .map((mechanism) => mechanism.textContent)
    .filter((name): name is SaslMechanism => name in SECURITY_LEVELS)
    .sort((a, b) => SECURITY_LEVELS[b] - SECURITY_LEVELS[a]);

  const selected = supported[0];
  if (!selected) throw new Error("不受支持的认证机制");
  return selected;
}

/**
 * 从流功能宣告中收集所有命名空间及可选的实体能力 (Entity Caps)。
 */
export function collectStreamFeatures(
  features: XMPPElement,
): StreamFeatures {
  const namespaces = new Set<string>();
  let entityCaps: Capabilities | undefined;

  for (const feature of features.childNodes) {
    if (!(feature instanceof XMPPElement) || !feature.namespaceURI) continue;
    // 收集所有功能命名空间
    namespaces.add(feature.namespaceURI);
    // 如果是实体能力声明 (XEP-0115)，解析出能力信息
    if (feature.namespaceURI === EntityCaps.NS) {
      entityCaps = EntityCaps.parseCaps(feature).cap;
    }
  }

  return { namespaces, entityCaps };
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
 * 从 SASL failure stanza 中提取失败条件名称。
 * 跳过 text 元素（可选的人类可读描述），返回第一个非 text 子元素的 localName。
 */
export function getSaslFailureCondition(stanza: XMPPElement): string {
  for (const child of stanza.childNodes) {
    if (child instanceof XMPPElement && child.localName !== "text") {
      return child.localName;
    }
  }
  return "not-authorized";
}

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
 * 从流错误 stanza 中提取错误条件名称。
 * 优先匹配 STREAM_ERROR_NS 命名空间下的子元素，
 * 回退接受无命名空间或空命名空间的元素以兼容部分实现。
 */
export function getStreamErrorCondition(stanza: XMPPElement): string {
  for (const child of stanza.childNodes) {
    if (!(child instanceof XMPPElement) || child.localName === "text") {
      continue;
    }
    // 标准条件应在 STREAM_ERROR_NS 下；兼容无命名空间的情况
    if (
      child.namespaceURI === STREAM_ERROR_NS ||
      child.namespaceURI === null ||
      child.namespaceURI === ""
    ) {
      return child.localName;
    }
  }
  return "undefined-condition";
}

/** 构建 SASL <auth> XML。 */
function buildAuthXml(
  mechanism: SaslMechanism,
  initialResponseBase64: string,
): string {
  const auth = XMPPElement.createElementNS(SASL_NS, "auth", { mechanism });
  auth.textContent = initialResponseBase64;
  return auth.toXMLString();
}

/** 构建 SASL <response> XML。 */
function buildResponseXml(responseBase64: string): string {
  const response = XMPPElement.createElementNS(SASL_NS, "response");
  response.textContent = responseBase64;
  return response.toXMLString();
}

/**
 * 构建资源绑定 IQ (RFC 6120 §7)。
 * 生成形如 `<iq type="set" id="bind-xxx"><bind xmlns="..."/></iq>` 的请求。
 *
 * @param resource - 可选的资源标识符，不传则由服务器自动分配。
 */
export function buildBindRequest(resource?: string): BindRequest {
  const id = `bind-${generateSecureNonce(8)}`;
  const iq = XMPPElement.createElement("iq", { type: "set", id });

  const bind = XMPPElement.createElementNS(BIND_NS, "bind");
  if (resource) {
    const resourceElement = XMPPElement.createElement("resource");
    resourceElement.textContent = resource;
    bind.appendChild(resourceElement);
  }
  iq.appendChild(bind);
  return { id, data: iq.toXMLString() };
}

/**
 * 解析资源绑定结果 IQ，验证并返回绑定的完整 JID。
 *
 * @param response - 服务器返回的 IQ stanza。
 * @param expectedBareJid - 期望的 bare JID（用于一致性校验）。
 * @returns 绑定的完整 JID（含资源）。
 * @throws 当绑定失败、返回非法 JID 或与期望身份不匹配时。
 */
export function parseBindResult(
  response: XMPPElement,
  expectedBareJid: string,
): JID {
  const type = response.getAttribute("type");
  // 服务器返回错误：提取错误条件
  if (type === "error") {
    const error = response.getElementsByTagName("error")[0];
    // 条件元素在 <text/> 之前（RFC 6120 §8.3.2），取首个非 text 子元素
    let condition = "unknown";
    for (const child of error?.children ?? []) {
      if (child.localName !== "text") {
        condition = child.localName;
        break;
      }
    }
    throw new Error(`资源绑定失败: ${condition}`);
  }
  if (type !== "result") {
    throw new Error(`资源绑定失败: 意外的 IQ type=${type ?? "null"}`);
  }

  const jidText = response.getElementsByTagName("jid")[0]?.textContent?.trim();
  if (!jidText) throw new Error("资源绑定失败: 响应缺少 jid");

  // 验证 JID 合法性
  let bound: JID;
  try {
    bound = new JID(jidText);
  } catch {
    throw new Error(`资源绑定失败: 非法 jid ${jidText}`);
  }
  // 防止服务器返回与认证身份不一致的 JID（安全校验）
  if (bound.bare !== expectedBareJid) {
    throw new Error(
      `资源绑定失败: 返回 JID ${bound.bare} 与认证身份 ${expectedBareJid} 不一致`,
    );
  }
  return bound;
}

/**
 * TCP 与 WebSocket 共用的 SASL 客户端计算器。
 *
 * 纯计算无网络副作用：根据收到的流功能宣告选择最优认证机制，
 * 计算并返回认证响应的 XML 序列化结果，供调用者发送到服务器。
 */
export class SaslClient {
  private readonly state: SaslData = {};

  constructor(private readonly jid: JID) {}

  /** 当前使用的 SASL 机制，在调用 start() 后可用。 */
  get mechanism(): SaslData["mechanism"] {
    return this.state.mechanism;
  }

  /** 清除上一次认证的中间状态（重连前调用） */
  reset(): void {
    this.state.mechanism = undefined;
    this.state.clientFirstMessageBare = undefined;
    this.state.serverProof = undefined;
  }

  /**
   * 启动 SASL 认证：选择机制并生成初始认证响应。
   *
   * - PLAIN：直接发送用户名+密码的 Base64 编码。
   * - SCRAM-SHA-1：发送 client-first-message-bare（省略 gs2-header）。
   *
   * @param features - 服务器流功能宣告。
   * @param password - 明文密码，仅本调用期间使用，不驻留实例。
   * @returns 要发送给服务器的 XML 字符串。
   */
  start(features: XMPPElement, password: string): string {
    const mechanism = selectSaslMechanism(features);
    this.state.mechanism = mechanism;

    if (mechanism === "PLAIN") {
      // PLAIN 格式: \0username\0password
      const plain = `\0${this.jid.local}\0${password}`;
      return buildAuthXml(mechanism, utf8ToBase64(plain));
    }

    // SCRAM-SHA-1: 构造 client-first-message-bare (n=用户名,r=随机nonce)
    // RFC 5802 §5.1：用户名中的 = 与 , 需转义，否则服务端按属性分隔符解析会截断
    const username = this.jid.local
      .replace(/=/g, "=3D")
      .replace(/,/g, "=2C");
    this.state.clientFirstMessageBare =
      `n=${username},r=${generateSecureNonce()}`;
    // 完整 client-first-message 包含 gs2-header (n,,) + client-first-message-bare
    return buildAuthXml(
      mechanism,
      utf8ToBase64(`n,,${this.state.clientFirstMessageBare}`),
    );
  }

  /**
   * 处理服务器的 SASL stanza（challenge/success/failure）。
   *
   * - PLAIN：一次性认证，只需判断 success/failure。
   * - SCRAM-SHA-1：多轮交互，收到 challenge 后计算响应。
   *
   * @param stanza - 服务器发来的 SASL stanza。
   * @param password - 明文密码，仅本调用期间使用，不驻留实例。
   * @returns 下一步行动：send（需回复 XML）/ success / ignore。
   */
  async process(stanza: XMPPElement, password: string): Promise<SaslResult> {
    // 生命周期守卫：必须先 start() 选定机制
    if (!this.state.mechanism) {
      throw new Error("SaslClient 尚未 start，无法处理 SASL stanza");
    }

    // 统一处理认证失败
    if (stanza.localName === "failure" && stanza.namespaceURI === SASL_NS) {
      throw new SaslError(getSaslFailureCondition(stanza));
    }

    // PLAIN 仅一轮交互，直接判断 success
    if (this.state.mechanism === "PLAIN") {
      return stanza.localName === "success" && stanza.namespaceURI === SASL_NS
        ? { type: "success" }
        : { type: "ignore" };
    }

    // 至此机制必为 SCRAM-SHA-1（守卫已排除未选机制，PLAIN 已在上方返回）
    // SCRAM-SHA-1: 处理服务器的 challenge
    if (stanza.localName === "challenge" && stanza.namespaceURI === SASL_NS) {
      const challenge = stanza.textContent;
      if (!challenge) throw new Error("空的 SCRAM challenge");

      // 计算 client-final-message + 缓存 server-proof 用于最终验证
      const { clientResponse, serverProof } = await scramResponse(
        password,
        challenge,
        this.state.clientFirstMessageBare!,
        "SCRAM-SHA-1",
      );
      this.state.serverProof = serverProof;
      return { type: "send", data: buildResponseXml(clientResponse) };
    }

    // SCRAM-SHA-1: 处理服务器的 success（含 server signature 验证）
    if (stanza.localName === "success" && stanza.namespaceURI === SASL_NS) {
      this.verifyScramSuccess(stanza);
      return { type: "success" };
    }
    return { type: "ignore" };
  }

  /**
   * 验证 SCRAM 服务器的最终签名。
   * 从 success 载荷的 Base64 解码后提取 v= 属性值，与本地计算的 serverProof 对比。
   */
  private verifyScramSuccess(stanza: XMPPElement): void {
    const raw = stanza.textContent;
    if (!raw) throw new Error("无法解析服务器签名：空 success 载荷");

    let payload: string;
    try {
      payload = atob(raw);
    } catch {
      throw new Error("无法解析服务器签名：非法 Base64");
    }

    // SASL 属性格式：v=base64signature,r=...,p=...
    const signature = parseSaslAttributes(payload).v;
    if (!signature) throw new Error("无法解析服务器签名：缺少 v=");
    // 验证服务器签名与本地计算结果一致，防止中间人篡改
    if (signature !== this.state.serverProof) {
      throw new Error("服务器签名不匹配");
    }
  }
}

export { SASL_NS, BIND_NS, STREAM_NS, STREAM_ERROR_NS };
