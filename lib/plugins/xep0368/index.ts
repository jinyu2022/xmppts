import { resolveSrv, type EndpointInfo } from "@/dns";
import type { Plugin } from "../types";
import type { Connection } from "../../connection";
import logger from "@/log";

const log = logger.getLogger("XEP0368");

/**
 * XEP-0368：SRV records for XMPP over TLS
 * @see https://xmpp.org/extensions/xep-0368.html
 * @version 1.1.0 (2019-08-20)
 */
class XEP0368 implements Plugin {
  /** 直连 TLS 服务的 SRV 记录名 */
  static readonly SRV_SERVICE = "_xmpps-client._tcp";
  /** 回退服务：RFC 6120 §3.2.1 常规 SRV 记录 */
  static readonly FALLBACK_SERVICE = "_xmpp-client._tcp";
  /** @private */
  readonly connection: Connection;
  // 考虑到意外的断链可能是服务器ip相关问题，因此不进行缓存
  constructor(connection: Connection) {
    this.connection = connection;
    // 构造函数先于传输创建：覆盖默认 xmpp 传输，在 create() 中决定直连 TLS 或明文 TCP
    connection.registerTransport(
      "xmpp",
      async ({ jid, password, tls, ...endpoint }) => {
        // 覆盖了 defaultTransports.xmpp，Node 环境守卫需在本工厂内重做
        if (typeof process === "undefined") {
          throw new Error("xmpp 协议仅支持 Node.js 环境");
        }
        // 端点必须 host + port 完整；不完整时视为未指定，交给 SRV 发现
        if (tls && !(endpoint.host && endpoint.port != null)) {
          const discovered = (await XEP0368.resolveDirectTLS(jid.domain))[0];
          if (discovered) {
            const { default: XMPPSConnection } = await import(
              "../../transport/tcp-direct.js"
            );
            log.debug(
              `使用直连 TLS 端点: ${discovered.host}:${discovered.port}`,
            );
            return new XMPPSConnection(jid, password, discovered);
          }
        }
        const { default: XMPPConnection } = await import(
          "../../transport/tcp.js"
        );
        return new XMPPConnection(jid, password, tls, endpoint);
      },
    );
  }

  /** 发现与传输选择在构造函数与 provider.create() 中完成，运行期无需额外初始化 */
  init() {}

  /**
   * 查询直连 TLS SRV 记录（XEP-0368 §4.1）
   * 无直连 TLS 记录时由连接层继续执行普通 TCP/TLS 流程
   * @param domain 要解析的域名
   * @returns 按优先级排序的直连 TLS 端点列表
   */
  static async resolveDirectTLS(domain: string): Promise<EndpointInfo[]> {
    return resolveSrv(`${XEP0368.SRV_SERVICE}.${domain}`);
  }
}
export default XEP0368;
