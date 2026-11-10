import logger from "@/log";
import { XMPPElement } from "@/ltx/Element";

const log = logger.getLogger("XEP0059");

/** RSM 请求参数（XEP-0059 §2） */
export interface RsmRequest {
    /** 每页最大条数，0 表示只取总数 */
    max?: number;
    /** 从该 UID 之后开始，用于向前翻页 */
    after?: string;
    /** 从该 UID 之前开始，用于向后翻页；空串表示取最后一页 */
    before?: string;
    /** 从该索引开始，用于乱序取页 */
    index?: number;
}

/** RSM 响应中的分页信息（XEP-0059 §2.2） */
export interface RsmResult {
    /** 本页第一条的 UID；`index` 是它在完整结果集中的位置 */
    first?: { value: string; index?: number };
    /** 本页最后一条的 UID */
    last?: string;
    /** 完整结果集的条数，可能为近似值 */
    count?: number;
}

/**
 * XEP-0059: Result Set Management
 *
 * 纯工具类：构造 `<set/>` 请求、解析 `<set/>` 响应，供 MAM、PubSub 等协议复用。
 * @see https://xmpp.org/extensions/xep-0059.html
 * @version 1.0 (2006-09-20)
 */
export class RSM {
    static readonly NS = "http://jabber.org/protocol/rsm";

    /**
     * 构造 `<set/>` 请求元素
     * @param request 分页参数，全部省略时得到空 `<set/>`
     * @returns 命名空间为 {@link RSM.NS} 的 `<set/>` 元素
     */
    static createSetEl(request: RsmRequest): XMPPElement {
        const set = XMPPElement.createElementNS(RSM.NS, "set");
        if (request.max !== undefined) {
            const max = XMPPElement.createElement("max");
            max.textContent = String(request.max);
            set.appendChild(max);
        }
        if (request.after !== undefined) {
            const after = XMPPElement.createElement("after");
            after.textContent = request.after;
            set.appendChild(after);
        }
        if (request.before !== undefined) {
            const before = XMPPElement.createElement("before");
            // 空串即规范 §2.4 的空 <before/>，表示请求最后一页
            if (request.before) before.textContent = request.before;
            set.appendChild(before);
        }
        if (request.index !== undefined) {
            const index = XMPPElement.createElement("index");
            index.textContent = String(request.index);
            set.appendChild(index);
        }
        return set;
    }

    /**
     * 解析 `<set/>` 响应
     *
     * @param el `<set/>` 元素，或其直接包含 `<set/>` 的父元素
     * @returns 合并到 stanza 上的 `{ rsm }`
     * @throws 未找到 `<set/>` 时抛出 Error
     */
    static parseSetEl(el: XMPPElement): Record<"rsm", RsmResult> {
        const set =
            el.getAttribute("xmlns") === RSM.NS
                ? el
                : el.querySelector(`:scope > set[xmlns="${RSM.NS}"]`);
        if (!set) throw new Error(`未找到 set 元素: ${el.toXMLString()}`);
        // first/last/count 与 set 同属 RSM 命名空间，靠继承，按标签名取
        const firstEl = set.querySelector(":scope > first");
        const lastEl = set.querySelector(":scope > last");
        const countEl = set.querySelector(":scope > count");
        const result: RsmResult = {};
        if (firstEl) {
            result.first = { value: firstEl.textContent };
            const raw = firstEl.getAttribute("index");
            if (raw !== null) {
                const index = raw.trim() === "" ? NaN : Number(raw);
                if (Number.isInteger(index) && index >= 0) {
                    result.first.index = index;
                } else {
                    log.warn("忽略非法的 <first index>", JSON.stringify(raw));
                }
            }
        }
        if (lastEl) result.last = lastEl.textContent;
        if (countEl) {
            const raw = countEl.textContent;
            const count = raw.trim() === "" ? NaN : Number(raw);
            if (Number.isInteger(count) && count >= 0) {
                result.count = count;
            } else {
                log.warn("忽略非法的 <count>", JSON.stringify(raw));
            }
        }
        return { rsm: result };
    }
}
