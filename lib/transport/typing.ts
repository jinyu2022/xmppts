import type { XMPPElement } from "@/ltx";
import type { EventEmitter } from "node:events";
import type { Pipeline } from "./pipeline";
import type { TransportPipelineEvents } from "./tcp";
/**
 * TCP / WebSocket 传输层共用接口。
 * 高层 Connection 通过此接口订阅协商完成与 stanza，不关心底层 framing 差异。
 */
export interface TransportSocket extends EventEmitter {
    status: number;
    host: string;
    port: string;
    pipeline: Pipeline<TransportPipelineEvents>;
    streamFeatures: Set<string>;
    connect(url?: string): Promise<void>;
    /** 复用同一实例（保留管线与会话状态）重新建立底层连接 */
    reconnect(): Promise<void>;
    send(data: string | XMPPElement): void;
    disconnect(): void;
}

/** XMPP连接状态常量 */
export const Status = {
    /** 客户端未连接 */
    DISCONNECTED: 0,
    /** 正在连接到服务器 */
    CONNECTING: 1,
    /** 已成功连接到服务器 */
    CONNECTED: 2,
    /** 正在建立xmpp流 */
    STREAM_START: 3,
    /** xmpp流建立成功 */
    STREAM_ESTABLISHED: 4,
    /** 正在进行 STARTTLS 协商（RFC 6120 §5） */
    STARTTLS: 5,
    /** TLS 已升级/直连建立，等待认证前流特性 */
    TLS_ESTABLISHED: 6,
    /** 正在进行身份验证 */
    AUTHENTICATING: 7,
    /** 身份验证成功 */
    AUTHENTICATED: 8,
    /** 正在进行资源绑定 */
    BINDING: 9,
    /** 资源绑定成功 */
    BINDED: 10,
    /** 身份验证失败 */
    AUTHFAIL: 11,
    /** 会话已开始 */
    SESSIONSTART: 12,
    /** 正在重新连接 */
    RECONNECTING: 13,
    /** 已重新连接 */
    DISCONNECTING: 40,
    /** 发生错误 */
    ERROR: 41,
    /** 操作超时 */
    TIMEOUT: 42,
    /** 会话结束 */
    SESSIONEND: 43,
} as const;

export interface SaslData {
    mechanism?: "PLAIN" | "SCRAM-SHA-1";
    clientFirstMessageBare?: string;
    serverProof?: string;
}