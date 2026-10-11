import { PEP } from "../xep0163/pep";
import { XMPPElement } from "@/ltx/Element";
import { JID } from "@/JID";

export interface AvatarMetadata {
    id: string;
    type: string;
    bytes: number;
    width?: number;
    height?: number;
    url?: string;
}
export class Avatar {
    static readonly NS = {
        metadata: "urn:xmpp:avatar:metadata",
        data: "urn:xmpp:avatar:data",
    } as const;

    /** 浏览器环境 */
    private static async browserImageParser(image: File) {
        const base64Data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(image);
        });

        const sha1 = await crypto.subtle
            .digest("SHA-1", await image.arrayBuffer())
            .then((hash) =>
                Array.from(new Uint8Array(hash))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")
            );

        const metadata = await new Promise<AvatarMetadata>((resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({
                    id: sha1,
                    type: image.type,
                    bytes: image.size,
                    width: img.width,
                    height: img.height,
                });
            };
            img.src = URL.createObjectURL(image);
        });

        return {
            base64Data,
            metadata,
        };
    }

    private static async nodeImageParser(imagePath: string) {
        // 图片类型映射
        const IMAGE_TYPES = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
        } as const;
        const { readFile, stat } = await import("node:fs/promises");
        // 获取文件信息和内容
        const [fileStats, fileBuffer] = await Promise.all([
            stat(imagePath),
            readFile(imagePath),
        ]);

        const { imageSize } = await import("image-size");
        const dimensions = imageSize(fileBuffer);
        const mimeType = IMAGE_TYPES[dimensions.type as keyof typeof IMAGE_TYPES];
        if (!mimeType) {
            throw new Error(`不支持的图片类型: ${dimensions.type}`);
        }

        const base64Data = fileBuffer.toString("base64");
        const sha1 = await crypto.subtle
            .digest("SHA-1", fileBuffer)
            .then((hash) =>
                Array.from(new Uint8Array(hash))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")
            );

        return {
            base64Data,
            metadata: {
                id: sha1,
                type: mimeType,
                bytes: fileStats.size,
                width: dimensions.width,
                height: dimensions.height,
            },
        };
    }

    /**
     * 解析图片
     * @param image node下绝对路径，浏览器下File对象
     * @returns base64编码的图片与图片元数据
     */
    static async imageParser(
        image: File | string
    ): Promise<{ base64Data: string; metadata: AvatarMetadata; }> {
        if (typeof image === "string" && typeof process !== "undefined") {
            return Avatar.nodeImageParser(image);
        } else if (image instanceof File && typeof window !== "undefined") {
            return Avatar.browserImageParser(image);
        } else {
            throw new Error("不支持的图片类型");
        }
    }
    //TODO: 允许使用http上传头像，并在info中包含url

    /** 构建上传头像与元数据iq，只接受png格式，格式转换不是本模块的职责
     * @param img 图片文件或路径
     * @returns [dataIq, metadataIq]
     */
    static async createDataPublishIq(img: File | string) {
        const { base64Data, metadata } = await Avatar.imageParser(img);
        /** @see https://xmpp.org/extensions/xep-0084.html#proto-info */
        if (metadata.type !== "image/png") throw new Error("只支持png格式的图片");

        const publishDate = XMPPElement.createElement("publish", {
            node: Avatar.NS.data,
        });
        const item = XMPPElement.createElement("item", { id: metadata.id });
        const data = XMPPElement.createElementNS(Avatar.NS.data, "data");
        data.textContent = base64Data;
        item.appendChild(data);
        publishDate.appendChild(item);

        const publishMetadata = XMPPElement.createElement("publish", {
            node: Avatar.NS.metadata,
        });
        const itemMetadata = XMPPElement.createElement("item", {
            id: metadata.id,
        });
        const metadataEl = XMPPElement.createElementNS(
            Avatar.NS.metadata,
            "metadata"
        );
        const infoEl = XMPPElement.createElement("info", {
            id: metadata.id,
            type: metadata.type,
            bytes: metadata.bytes.toString(),
            width: metadata.width!.toString(),
            height: metadata.height!.toString(),
        });
        metadataEl.appendChild(infoEl);
        itemMetadata.appendChild(metadataEl);
        publishMetadata.appendChild(itemMetadata);

        return [
            PEP.createPublishIq(publishDate),
            PEP.createPublishIq(publishMetadata),
        ];
    }
    /**
     * 构造获取头像数据iq
     * @param to 对方jid
     * @param id sha-1值
     */
    static createRetrieveDataIq(to: string | JID, id: string) {
        // §3.4：按元数据里的 ItemID 从 data 节点取该头像数据
        return PEP.createRetrieveItemsIq(to, Avatar.NS.data, undefined, [id]);
    }

    static parseMetadataEl(metadata: XMPPElement) {
        if (metadata.namespaceURI !== Avatar.NS.metadata)
            throw new Error("不是一个metadata元素");
        const infoEl = metadata.getElementsByTagName("info")[0];
        /** 元素存在但没有 info 子元素（空 metadata） */
        if (!infoEl) return {metadata: null};
        return {
            metadata: {
                id: infoEl.getAttribute("id")!,
                type: infoEl.getAttribute("type")!,
                bytes: parseInt(infoEl.getAttribute("bytes")!),
                width: infoEl.getAttribute("width")
                    ? parseInt(infoEl.getAttribute("width")!)
                    : undefined,
                height: infoEl.getAttribute("height")
                    ? parseInt(infoEl.getAttribute("height")!)
                    : undefined,
                url: infoEl.getAttribute("url") || undefined,
            },
        };
    }
}
