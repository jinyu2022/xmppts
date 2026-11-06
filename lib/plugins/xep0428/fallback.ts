import { XMPPElement } from "@/ltx/Element";
import logger from "@/log";

const log = logger.getLogger("XEP0428");

/** 回退区间；`start`/`end` 为 Unicode 码点索引，省略表示覆盖整个元素 */
export interface FallbackRegion {
    /** 起始码点（含） */
    start?: number;
    /** 结束码点（不含） */
    end?: number;
}

/** 一条 `<fallback/>` 的解析结果 */
export interface FallbackInfo {
    /** 被回退替换的规范命名空间；缺失时为空串 */
    for: string;
    /** `<body/>` 中的回退区间 */
    body?: FallbackRegion[];
    /** `<subject/>` 中的回退区间 */
    subject?: FallbackRegion[];
}

/**
 * XEP-0428: Fallback Indication
 *
 * 标记消息正文或主题中仅供旧客户端显示的回退内容。
 * @see https://xmpp.org/extensions/xep-0428.html
 * @version 0.2.1 (2024-03-20)
 */
export class Fallback {
    static readonly NS = "urn:xmpp:fallback:0" as const;

    /**
     * 解析 `urn:xmpp:fallback:0` 命名空间下的 `<fallback/>`
     *
     * 一条消息可以有多条 fallback，故从父元素一次收集全量。
     * @param fallbackEl 任一 fallback 元素
     */
    static parseFallbackEl(
        fallbackEl: XMPPElement,
    ): { fallbacks?: FallbackInfo[]; } {
        if (fallbackEl.namespaceURI !== Fallback.NS) {
            throw new Error(`不是一个 fallback 元素: ${fallbackEl.toXMLString()}`);
        }
        const parent = fallbackEl.parentElement;
        if (parent && parent.localName !== "message") {
            log.warn(`忽略非消息中的 fallback: ${fallbackEl.toXMLString()}`);
            return {};
        }
        const elements = parent
            ? Array.from(parent.children).filter(
                (child) =>
                    child.namespaceURI === Fallback.NS &&
                    child.localName === "fallback",
            )
            : [fallbackEl];

        const fallbacks: FallbackInfo[] = [];
        for (const element of elements) {
            fallbacks.push(Fallback.parseOne(element));
        }
        return fallbacks.length > 0 ? { fallbacks } : {};
    }

    /** 解析单条 fallback */
    private static parseOne(fallbackEl: XMPPElement): FallbackInfo {
        const info: FallbackInfo = {
            for: fallbackEl.getAttribute("for") ?? "",
        };
        if (!info.for) {
            log.warn(`fallback 缺少 for 属性: ${fallbackEl.toXMLString()}`);
        }

        let hasChild = false;
        let hasRegion = false;
        for (const child of fallbackEl.children) {
            const localName = child.localName;
            if (localName !== "body" && localName !== "subject") {
                log.warn(
                    `忽略未知的 fallback 子元素: ${child.toXMLString()}`,
                );
                continue;
            }
            hasChild = true;
            const start = Fallback.parseOffset(child.getAttribute("start"));
            const end = Fallback.parseOffset(child.getAttribute("end"));
            // 属性存在但不是 xs:unsignedInt：丢弃这个区间，不能让非法值退化成 0
            if (start === null || end === null) continue;

            const region: FallbackRegion = {};
            if (start !== undefined) region.start = start;
            if (end !== undefined) region.end = end;

            const list = info[localName] ?? [];
            list.push(region);
            info[localName] = list;
            hasRegion = true;
        }

        // 没有任何子元素时，正文与主题整体都是回退内容（§2）；
        // 有子元素但全部非法时不套用整段回退，保留原文
        if (!hasChild) {
            info.body = [];
            info.subject = [];
        } else if (!hasRegion) {
            log.warn(`忽略没有有效区间的 fallback: ${fallbackEl.toXMLString()}`);
        }
        return info;
    }

    /**
     * 解析码点偏移
     * @param value 属性值
     * @returns 非负整数；属性缺失时返回 `undefined`，词法非法（非 xs:unsignedInt）时返回 `null`
     */
    private static parseOffset(value: string | null): number | undefined | null {
        if (value === null) return undefined;
        if (!/^\d+$/.test(value)) {
            log.warn(`忽略非法的 fallback 偏移: ${value}`);
            return null;
        }
        const offset = Number(value);
        if (!Number.isSafeInteger(offset)) {
            log.warn(`忽略超出范围的 fallback 偏移: ${value}`);
            return null;
        }
        return offset;
    }

    /**
     * 构造 `<fallback/>`
     * @param info 回退信息
     * @throws `for` 为空，或存在非法区间时
     */
    static createFallbackEl(info: FallbackInfo): XMPPElement {
        if (!info.for) {
            throw new Error("fallback 的 for 属性不能为空");
        }
        const fallbackEl = XMPPElement.createElementNS(Fallback.NS, "fallback", {
            for: info.for,
        });

        for (const tagName of ["subject", "body"] as const) {
            for (const region of info[tagName] ?? []) {
                const regionEl = XMPPElement.createElement(tagName);
                if (region.start !== undefined) {
                    Fallback.assertOffset(region.start);
                    regionEl.setAttribute("start", String(region.start));
                }
                if (region.end !== undefined) {
                    Fallback.assertOffset(region.end);
                    regionEl.setAttribute("end", String(region.end));
                }
                fallbackEl.appendChild(regionEl);
            }
        }
        return fallbackEl;
    }

    /** 校验码点偏移 */
    private static assertOffset(value: number): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`fallback 偏移必须是非负整数: ${value}`);
        }
    }

    /**
     * 按回退区间移除文本片段
     *
     * `start`/`end` 按 Unicode 码点计（XEP-0426），不能用 UTF-16 的字符串下标。
     * 越界区间会被裁剪到文本范围内。
     * @param text 原始正文或主题
     * @param regions 回退区间；`undefined` 表示该元素没有回退内容，
     *   空数组表示整段都是回退内容
     */
    static stripFallback(
        text: string,
        regions?: FallbackRegion[],
    ): string {
        // 未提供区间：这条 fallback 没有针对该元素的回退，原文保持不动
        if (regions === undefined) return text;
        // 空数组：fallback 没有子元素，整段都是回退内容（§2）
        if (regions.length === 0) return "";

        const codePoints = Array.from(text);
        const removed = new Array<boolean>(codePoints.length).fill(false);
        for (const region of regions) {
            const start = Math.max(0, region.start ?? 0);
            const end = Math.min(
                codePoints.length,
                region.end ?? codePoints.length,
            );
            for (let index = start; index < end; index++) {
                removed[index] = true;
            }
        }
        return codePoints.filter((_, index) => !removed[index]).join("");
    }
}
