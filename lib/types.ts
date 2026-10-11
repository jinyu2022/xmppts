export interface Options {
  protocol?: Protocol;
  host?: string;
  port?: number;
  path?: string;
  tls?: boolean;
  /** 是否启用重连 */
  reconnect?: boolean;
  /** 初始重连间隔（ms），按指数退避增长 */
  reconnectInterval?: number;
  /** 最大重连间隔 */
  reconnectMaxInterval?: number;
  /** 最大重连次数 */
  reconnectMaxAttempts?: number;
}
export type Protocol = "ws" | "http" | "xmpp";
