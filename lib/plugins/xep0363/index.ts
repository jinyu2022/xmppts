import type Connection from "@/connection";
import type { JID } from "@/JID";
import { XMPPError } from "@/errors";
import logger from "@/log";
import type { Plugin } from "../types";
import {
    HttpUpload,
    type SlotRequestOptions,
    type UploadPurpose,
    type UploadService,
    type UploadSlot,
} from "./httpUpload";

const log = logger.getLogger("XEP0363");

/** 上传的数据；三者都能直接作为 fetch 的 body */
export type UploadData = Blob | ArrayBuffer | Uint8Array;

/** 区分 Blob 与 ArrayBuffer/类型化数组，同时兼容没有 Blob 的运行环境 */
function isBlob(data: UploadData): data is Blob {
    return typeof Blob !== "undefined" && data instanceof Blob;
}

/** {@link XEP0363.upload} 的选项 */
export interface UploadOptions extends SlotRequestOptions {
    /** 指定上传服务；缺省时使用 init 阶段发现并缓存的服务 */
    service?: string | JID;
    /** 中止上传的信号；取消时 `fetch` 以 `AbortError` 拒绝 */
    signal?: AbortSignal;
}

/**
 * XEP-0363: HTTP File Upload
 *
 * 通过 disco 发现上传服务并请求上传槽，再用 HTTP PUT 上传文件。
 * 文件的后续分发（消息、头像等）由调用方负责。
 * @see https://xmpp.org/extensions/xep-0363.html
 * @version 1.2.0 (2025-06-17)
 */
export class XEP0363 extends HttpUpload implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    /** 配置中指定的上传服务；未指定时自动发现 */
    private readonly configuredService?: string | JID;
    /** 已发现的服务器信息；尚未发现或不可用时为 null */
    private service: UploadService | null = null;

    constructor(
        connection: Connection,
        options?: { service?: string | JID },
    ) {
        super();
        this.connection = connection;
        this.configuredService = options?.service;
    }

    /** 当前可用的上传服务；尚未发现或不可用时为 null */
    get uploadService(): UploadService | null {
        return this.service;
    }

    /** XEP-0363 的特性由上传服务在 disco#info 中宣告，客户端不代其宣告 */
    init() {
        // init 阶段发 IQ 会因传输未就绪报错，等会话建立后再发现并缓存
        this.connection.once("session:start", async () => {
            this.service = this.configuredService
                ? await this.discoverService(this.configuredService)
                : await this.findService(this.connection.jid.domain);
        });
    }

    /**
     * 从服务器的 disco#items 中查找上传服务
     *
     * 只看 JID 含 upload 的条目，再逐个确认其宣告 XEP-0363；没有这样的条目即视为无服务。
     * @param domain 要枚举 items 的实体
     * @returns 服务配置；未找到时为 null
     */
    private async findService(domain: string | JID): Promise<UploadService | null> {
        // 查询本机服务器 items
        const items = await this.connection.XEP0030!
            .getDiscoItems(domain)
            .catch(() => []);
        // 在列出的 items 中找有没有 upload 字段的
        const candidates = items.filter((item) =>
            item.jid.toLowerCase().includes("upload"),
        );
        // 对 upload 发送 info 查询看看是不是支持文件上传
        for (const item of candidates) {
            const service = await this.discoverService(item.jid);
            if (service) return service;
        }
        return null;
    }

    /**
     * 请求一个上传槽
     * @param service 上传服务 JID
     * @param filename 上传的文件名
     * @param size 文件大小（字节）
     * @param options 可选的 Content-Type 与上传用途
     * @throws 服务端返回错误节
     */
    async requestSlot(
        service: string | JID,
        filename: string,
        size: number,
        options?: SlotRequestOptions,
    ): Promise<UploadSlot> {
        const iq = HttpUpload.createRequestIqEl(
            service,
            filename,
            size,
            options,
        );
        const response = await this.connection.sendAsync(iq);
        if (response.getAttribute("type") === "error") {
            // 服务可能用 file-too-large/max-file-size 告知上限（§6）
            const maxSize = response.getElementsByTagNameNS(
                HttpUpload.NS,
                "max-file-size",
            )[0]?.textContent;
            throw new XMPPError(
                response,
                maxSize
                    ? `请求上传槽失败：文件超过服务端上限 ${maxSize} 字节`
                    : "请求上传槽失败",
            );
        }
        const slotEl = response.getElementsByTagNameNS(
            HttpUpload.NS,
            "slot",
        )[0];
        if (!slotEl) {
            throw new Error(`响应缺少 slot 元素: ${response.toXMLString()}`);
        }
        return HttpUpload.parseSlot(slotEl);
    }

    /**
     * 上传文件并返回下载 URL
     * @param filename 上传的文件名
     * @param data 文件内容
     * @param options 上传服务、用途与 Content-Type
     * @returns 下载 URL
     * @throws 服务不可用、超过大小限制、用途不支持或 HTTP 上传失败
     */
    async upload(
        filename: string,
        data: UploadData,
        options?: UploadOptions,
    ): Promise<string> {

        const size = isBlob(data) ? data.size : data.byteLength;
        const contentType =
            options?.contentType ??
            (isBlob(data) && data.type
                ? data.type
                : HttpUpload.DEFAULT_CONTENT_TYPE);

        // 优先使用本次指定的服务，其次使用 init 阶段缓存的服务；都没有时直接报错
        const service = options?.service
            ? await this.discoverService(options.service)
            : this.service;
        if (!service) {
            throw new Error("未找到支持 XEP-0363 的上传服务");
        }

        if (service.maxFileSize != null && size > service.maxFileSize) {
            throw new Error(
                `文件大小 ${size} 字节超过服务端上限 ${service.maxFileSize} 字节`,
            );
        }
        // message 是缺省用途，无需服务宣告
        if (
            options?.purpose &&
            options.purpose !== "message" &&
            !service.purposes.has(options.purpose)
        ) {
            throw new Error(
                `上传服务 ${service.jid} 不支持 ${options.purpose} 用途`,
            );
        }

        const slot = await this.requestSlot(
            service.jid,
            filename,
            size,
            {
                contentType,
                purpose: options?.purpose,
                expireBefore: options?.expireBefore,
            },
        );

        const headers = new Headers();
        headers.set("Content-Type", contentType);
        // slot 返回的头已按规范过滤并剥离换行，直接附加
        for (const header of slot.put.headers) {
            headers.append(header.name, header.value);
        }

        const response = await fetch(slot.put.url, {
            method: "PUT",
            headers,
            // TS 的 Uint8Array 泛型参数为 ArrayBufferLike，DOM 的 BufferSource 要求 ArrayBuffer；
            // 运行时的 fetch 两者都接受
            body: data as BodyInit,
            signal: options?.signal,
        });
        if (!response.ok) {
            const body = await response.text().catch((error: unknown) => {
                log.warn("读取上传失败响应体时出错", error);
                return "";
            });
            throw new Error(
                `文件上传失败：HTTP ${response.status}${body ? `，${body}` : ""}`,
            );
        }
        return slot.get.url;
    }

    /**
     * 发现上传服务
     *
     * 查询指定实体的 disco#info，确认其宣告 XEP-0363 后返回其配置。
     * @param domain 要查询的实体
     * @returns 服务 JID、最大文件大小与支持的用途；查询失败或未宣告时为 null
     */
    async discoverService(domain: string | JID): Promise<UploadService | null> {
        const info = await this.connection.XEP0030!
            .getDiscoInfo(domain)
            .catch((error: unknown) => {
                log.debug(`查询 ${domain.toString()} 的 disco#info 失败`, error);
                return null;
            });
        if (!info?.features.has(HttpUpload.NS)) {
            return null;
        }

        // 服务可能在扩展表单中用 max-file-size 宣告上限（§3），缺失或非法时视为未宣告
        const maxSize = Number(
            info.extensions?.fields.find(
                (field) => field.var === "max-file-size",
            )?.values[0],
        );

        // 服务用 urn:xmpp:http:upload:purpose:0#<用途> 特性宣告支持的用途（§5）
        const purposes = new Set<UploadPurpose>();
        const purposePrefix = `${HttpUpload.PURPOSE_NS}#`;
        for (const feature of info.features) {
            if (!feature.startsWith(purposePrefix)) continue;
            const purpose = feature.slice(purposePrefix.length);
            if (
                purpose === "message" ||
                purpose === "profile" ||
                purpose === "ephemeral" ||
                purpose === "permanent"
            ) {
                purposes.add(purpose);
            }
        }

        return {
            jid: domain.toString(),
            maxFileSize:
                Number.isInteger(maxSize) && maxSize > 0
                    ? maxSize
                    : undefined,
            purposes,
        };
    }
}

export default XEP0363;
