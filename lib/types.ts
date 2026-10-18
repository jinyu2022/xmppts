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
/** 内置连接协议 */
export type BuiltinProtocol = "ws" | "http" | "xmpp";
/**
 * 连接协议：内置协议保留字面量提示，自定义协议配合
 * `Connection.registerTransport()` 使用任意 scheme。
 */
export type Protocol = BuiltinProtocol | (string & Record<never, never>);
