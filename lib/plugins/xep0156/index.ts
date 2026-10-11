import type { Connection } from "../../connection";
import type { Plugin } from "../types";
import { XMPPDiscoverer } from "./discoverAltXMPP";
import logger from "@/log";
const log = logger.getLogger("XEP0156");

/**
 * XEP-0156: Discovering Alternative XMPP Connection Methods
 * @see https://xmpp.org/extensions/xep-0156.html
 * @version 1.4.0 (2022-02-10)
 */
class XEP0156 extends XMPPDiscoverer implements Plugin {
  readonly connection: Connection;
  constructor(connection: Connection) {
    super()
    this.connection = connection;
  }

  init() {
    // 已有连接地址、未连接、或协议无需发现时都跳过 host-meta 查询
    let skipReason: string | undefined;
    if (this.connection.url) skipReason = "已经有url";
    else if (!this.connection.transport) skipReason = "未连接";
    else if (!this.connection.protocol) skipReason = "未指定协议";
    else if (this.connection.protocol === "xmpp") skipReason = "xmpp协议";
    if (skipReason) {
      log.debug(`${skipReason}，不需要初始化`);
      return;
    }
    // 获取连接方法
    XEP0156.discoverAltXMPP(this.connection.jid.domain)
      .then((result) => {
        let urlStr;
        if (this.connection.protocol == "ws") {
          urlStr = result["websocket"];
        } else if (this.connection.protocol == "http") {
          urlStr = result["xbosh"];
        }else {
          throw new Error(`未找到协议 ${this.connection.protocol} 的连接方法`);
        }
        if (!urlStr) {
          throw new Error("未找到连接方法");
        }
        const url = new URL(urlStr);
        this.connection.host = url.hostname;
        // URL 无显式端口时 port 为空串,保持 undefined
        this.connection.port = url.port ? Number(url.port) : undefined;
        this.connection.path = url.pathname;
        if (this.connection.tls) {
          // 如果是tls协议，就用wss/https
          this.connection.url =  urlStr.replace("ws://", "wss://").replace("http://", "https://");
        }else{
          // 如果不是tls协议，就用ws/http
          this.connection.url = urlStr.replace("wss://", "ws://").replace("https://", "http://");
        }
      
        log.debug(`获取到连接方法: ${urlStr}`);
      })
      .catch((error) => {
        throw new Error(
          `获取连接方法失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }
}
export default XEP0156;
