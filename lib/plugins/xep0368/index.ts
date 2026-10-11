import { connect as tlsConnect } from "node:tls";
import { resolveSrv, type EndpointInfo } from "@/dns";
import type { Plugin } from "../types";
import { Connection } from "../../connection";
import { Status } from "../../transport/typing";
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
  }

  init() {
    // 连接前介入：直连 TLS 场景下用 _xmpps-client SRV 解析端点并注入加密 socket
    const socket = this.connection.transport;
    socket?.pipeline?.use("beforeConnect", async (ctx, next) => {
      if (ctx.url || !ctx.tls) return next(); // 已有地址，或非 TLS
      const endpoint = (await XEP0368.resolveDirectTLS(ctx.domain))[0];
      if (endpoint) {
        ctx.url = `xmpps://${endpoint.host}:${endpoint.port}`;
        // 直连 TLS
        const tls = tlsConnect({
          host: endpoint.host,
          port: endpoint.port,
          servername: ctx.domain,
          ALPNProtocols: ["xmpp-client"],
        });
        // 握手完成即置 TLS 就绪：features 只可能在 secureConnect 后到达，route 将按 TLS_ESTABLISHED 分派进 SASL
        tls.once("secureConnect", () => {
          socket.status = Status.TLS_ESTABLISHED;
        });
        ctx.setSocket!(tls);
        log.debug(`使用直连 TLS 端点: ${ctx.url}`);
      }
      return next();
    });
  }

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
