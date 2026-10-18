import { Parser } from "../../ltx/Parser";
import type { TransportEndpoint } from "../../transport/typing";
import { TimeoutError } from "@/errors";
import logger from "@/log";
const log = logger.getLogger("XEP0156");

/** host-meta 公布的替代连接方式（XEP-0156 §2.1） */
interface ConnectionMethods {
  websocket?: string;
  httppoll?: string;
  xbosh?: string;
}

/**
 * XEP-0156: Discovering Alternative XMPP Connection Methods
 *
 * 纯工具类：不实现 Plugin、不注册传输，由需要发现的传输层（WebSocket）
 * 在建立连接前调用静态方法获取端点。
 *
 * @see https://xmpp.org/extensions/xep-0156.html
 * @version 1.4.0 (2022-02-10)
 */
class XEP0156 {
  /**
   * 拉取 `https://<domain>/.well-known/host-meta` 并按 Link rel 归类
   * @param domain 账号域
   * @param timeout 请求超时（毫秒）
   * @returns 连接方式 URL，按关系索引
   * @throws HTTP 非 2xx、请求超时（{@link TimeoutError}）或网络错误
   */
  static async discoverAltXMPP(
    domain: string,
    timeout = 5000,
  ): Promise<ConnectionMethods> {
    const url = `https://${domain}/.well-known/host-meta`;
    // 单一超时通道：超时即 abort，fetch 随之结束，不再叠加 Promise.race
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    timeoutId.unref?.();

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`);
      }

      const text = await response.text();
      const doc = Parser.parse(text);
      const elements = doc.getElementsByTagName("Link");
      const result: ConnectionMethods = {};

      const REL_TO_KEY = {
        "urn:xmpp:alt-connections:websocket": "websocket",
        "urn:xmpp:alt-connections:httppoll": "httppoll",
        "urn:xmpp:alt-connections:xbosh": "xbosh",
      } as const;

      for (const element of elements) {
        const rel = element.getAttribute("rel");
        const href = element.getAttribute("href");
        if (rel && href) {
          if (rel in REL_TO_KEY) {
            const key = REL_TO_KEY[rel as keyof typeof REL_TO_KEY];
            result[key] = href;
          } else {
            log.warn(`发现未知的连接类型: ${rel}`);
          }
        }
      }

      return result;
    } catch (error) {
      // abort 是超时的唯一触发源，统一归一为 TimeoutError
      if (controller.signal.aborted) throw new TimeoutError("请求超时");
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 解析 host-meta 公布的 WebSocket 端点
   *
   * 只报告公布地址里的显式端口；缺省端口由传输按最终使用的 scheme 决定，
   * 避免公布地址的 scheme 与 `connection.tls` 不一致时端口取错。
   * @param domain 账号域
   * @returns 主机、端口（公布地址未显式给出时为 undefined）与路径
   * @throws 未公布 websocket 连接方式或请求失败
   */
  static async resolveEndpoint(domain: string): Promise<TransportEndpoint> {
    const result = await XEP0156.discoverAltXMPP(domain);
    const urlStr = result.websocket;
    if (!urlStr) throw new Error("未找到 websocket 连接方法");
    const url = new URL(urlStr);
    log.debug(`获取到 websocket 连接方法: ${urlStr}`);
    return {
      // URL.hostname 会保留 IPv6 的方括号，连接前去掉
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
    };
  }
}
export default XEP0156;
