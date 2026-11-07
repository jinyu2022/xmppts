import { XMPPElement } from "@/ltx/Element";
import { Iq } from "@/stanza";
import type { JID } from "@/JID";

/** XEP-0363 §5 定义的上传用途；缺省为 `message` */
export type UploadPurpose = "message" | "profile" | "ephemeral" | "permanent";

/** 请求上传槽的可选项 */
export interface SlotRequestOptions {
    /** Content-Type；缺省时由服务端按 application/octet-stream 处理 */
    contentType?: string;
    /** 上传用途，缺省为 `message` */
    purpose?: UploadPurpose;
    /** `ephemeral` 用途的过期时刻，对应 `expire-before`（规范要求必须提供） */
    expireBefore?: Date;
}

/** slot 中服务端指定的 HTTP 头 */
export interface UploadHeader {
    name: string;
    value: string;
}

/** 上传槽 */
export interface UploadSlot {
    /** 上传目标 URL 与服务端要求的请求头 */
    put: { url: string; headers: UploadHeader[] };
    /** 上传完成后的下载 URL */
    get: { url: string };
}

/** 上传服务的信息 */
export interface UploadService {
    /** 服务 JID */
    jid: string;
    /** 服务宣告的最大文件大小（字节）；未宣告时为 undefined */
    maxFileSize?: number;
    /** 服务宣告支持的用途 */
    purposes: Set<UploadPurpose>;
}

/**
 * XEP-0363: HTTP File Upload
 *
 * 负责上传槽请求、slot 响应解析与 disco 扩展信息读取；
 * HTTP 传输与重试策略由调用方或插件入口决定。
 * @see https://xmpp.org/extensions/xep-0363.html
 * @version 1.2.0 (2025-06-17)
 */
export class HttpUpload {
    static readonly NS = "urn:xmpp:http:upload:0" as const;
    /** 上传用途元素的命名空间（§5） */
    static readonly PURPOSE_NS = "urn:xmpp:http:upload:purpose:0" as const;
    static readonly DEFAULT_CONTENT_TYPE = "application/octet-stream" as const;
    /** slot 允许客户端携带的 HTTP 头（§4，大小写不敏感） */
    static readonly ALLOWED_HEADERS = new Set([
        "authorization",
        "cookie",
        "expires",
    ]);

    /**
     * 创建 IQ-get 上传槽请求
     * @param service 上传服务 JID
     * @param filename 上传的文件名
     * @param size 文件大小（字节），规范要求为正整数
     * @param options 可选的 Content-Type 与上传用途
     * @throws 大小不是正整数，或 `ephemeral` 用途缺少 `expireBefore`
     */
    static createRequestIqEl(
        service: string | JID,
        filename: string,
        size: number,
        options?: SlotRequestOptions,
    ) {
        if (!Number.isInteger(size) || size <= 0) {
            throw new Error(`文件大小必须是正整数: ${size}`);
        }

        const iq = Iq.createIq("get", service);
        const request = XMPPElement.createElementNS(HttpUpload.NS, "request", {
            filename,
            size: String(size),
        });
        if (options?.contentType) {
            // TODO: 应该校验一下是不是合法的 MIME 类型吧，但规范没有要求，暂不处理
            request.setAttribute("content-type", options.contentType);
        }

        // 未指定用途时服务端按 message 处理（§5），这里显式写出避免依赖服务端的默认行为
        const purpose = options?.purpose ?? "message";
        const purposeEl = XMPPElement.createElementNS(
            HttpUpload.PURPOSE_NS,
            purpose,
        );
        if (purpose === "ephemeral") {
            if (!options?.expireBefore) {
                throw new Error("ephemeral 用途必须提供 expireBefore");
            }
            purposeEl.setAttribute(
                "expire-before",
                options.expireBefore.toISOString(),
            );
        }
        request.appendChild(purposeEl);
        iq.appendChild(request);
        return iq;
    }

    /**
     * 解析服务端返回的上传槽
     * @param xml `<slot/>` 元素
     * @throws 命名空间不符、缺少 put/get 的 url、URL 非法或不是 HTTPS
     */
    static parseSlot(xml: XMPPElement): UploadSlot {
        if (xml.namespaceURI !== HttpUpload.NS) {
            throw new Error(`不是一个 HTTP 上传槽响应: ${xml.toXMLString()}`);
        }

        const putEl = xml.querySelector(":scope > put");
        const getEl = xml.querySelector(":scope > get");
        const putUrl = putEl?.getAttribute("url");
        const getUrl = getEl?.getAttribute("url");
        if (!putEl || !putUrl) {
            throw new Error(`slot 缺少 put 或 put 的 url: ${xml.toXMLString()}`);
        }
        if (!getEl || !getUrl) {
            throw new Error(`slot 缺少 get 或 get 的 url: ${xml.toXMLString()}`);
        }

        // 规范要求 put/get 的 URL 均为 HTTPS（§4），避免文件或凭据经明文传输
        for (const url of [putUrl, getUrl]) {
            let parsed: URL;
            try {
                parsed = new URL(url);
            } catch {
                throw new Error(`slot 的 url 不是合法的 URL: ${url}`);
            }
            if (parsed.protocol !== "https:") {
                throw new Error(`规范要求 slot 的 url 必须使用 HTTPS: ${url}`);
            }
        }

        const headers: UploadHeader[] = [];
        for (const child of putEl.children) {
            if (child.namespaceURI !== HttpUpload.NS || child.localName !== "header") 
                continue;
            
            // 规范要求名称与值都剥离换行（§4）
            const name = child.getAttribute("name")?.replace(/[\r\n]/g, "");
            if (!name) continue;
            const value = child.textContent?.replace(/[\r\n]/g, "");
            // 规范只允许 Authorization、Cookie、Expires，其余头必须忽略
            if (!HttpUpload.ALLOWED_HEADERS.has(name.toLowerCase())) continue;
            headers.push({
                name,
                value,
            });
        }

        return {
            put: { url: putUrl, headers },
            get: { url: getUrl },
        };
    }
}

export default HttpUpload;
