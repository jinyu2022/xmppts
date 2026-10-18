import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { XMPPConnection } from "./tcp";
import type { TransportEndpoint } from "./typing";
import type { JID } from "../JID";

/**
 * XMPP over direct TLS (XEP-0368 §3)。
 *
 * 建连即完成 TLS（默认端口 5223），跳过 STARTTLS；
 * 流协商、SASL 与资源绑定全部复用 {@link XMPPConnection}。
 */
export class XMPPSConnection extends XMPPConnection {
  /** direct TLS 默认端口（XEP-0368 §3） */
  protected override readonly defaultPort = "5223";
  /** 直连 TLS 端点由发现插件补全，传输层不查常规 SRV */
  protected override readonly srvService = undefined;

  /** @param endpoint 直连 TLS 端点；未提供时由传输层按默认端口解析 */
  constructor(jid: JID, password: string, endpoint?: TransportEndpoint) {
    super(jid, password, true, endpoint);
  }

  /** TLS 握手完成后才能发送流头 */
  protected override get readyEvent(): "secureConnect" {
    return "secureConnect";
  }

  /** 创建直连 TLS socket：SNI 用于虚拟主机，ALPN 标识 XMPP 客户端 */
  protected override createSocket(): TLSSocket {
    return tlsConnect({
      host: this.host,
      port: Number.parseInt(this.port),
      servername: this.domain,
      ALPNProtocols: ["xmpp-client"],
    });
  }
}

export default XMPPSConnection;
