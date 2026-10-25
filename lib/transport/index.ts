import type { JID } from "@/JID";
import type {
  TransportEndpoint,
  TransportSink,
  TransportSocket,
} from "./typing";

/**
 * 传输工厂上下文：创建底层传输所需的最小连接信息。
 *
 * 端点在创建实例时一并传入，由传输实现保存并在 `connect()` 时使用。
 */
export interface TransportContext extends TransportEndpoint {
  /** 登录 JID */
  readonly jid: JID;
  /** 登录密码 */
  readonly password: string;
  /** 是否期望 TLS（由具体传输解释：TCP 的 STARTTLS、WebSocket 的 wss） */
  readonly tls: boolean;
  /** 上层通知接收者：构造传输实例时一并传入，生命周期与实例一致 */
  readonly sink: TransportSink;
}

/**
 * 传输工厂：按协议创建一个传输实例。
 *
 * 实现内部可懒加载具体模块；返回值可以是 Promise（如先做 DNS 发现再决定实现）。
 */
export type TransportFactory = (
  context: TransportContext,
) => TransportSocket | Promise<TransportSocket>;

/**
 * 内置传输表：协议名 → 工厂。
 *
 * 保持动态 import，避免浏览器/非目标环境加载无关实现；
 * 这里只做协议到实现的映射，不包含任何协商逻辑。
 */
export const defaultTransports: Readonly<Record<string, TransportFactory>> = {
  xmpp: async ({ jid, password, tls, sink, ...endpoint }) => {
    if (typeof process === "undefined") {
      throw new Error("xmpp 协议（TCP/STARTTLS）仅支持 Node.js，浏览器请使用 ws");
    }
    const XMPPConnection = (await import("./tcp.js")).default;
    return new XMPPConnection(jid, password, sink, tls, endpoint);
  },
  ws: async ({ jid, password, tls, sink, ...endpoint }) => {
    const WSConnection = (await import("./websocket.js")).default;
    return new WSConnection(jid, password, sink, tls, endpoint);
  },
};
