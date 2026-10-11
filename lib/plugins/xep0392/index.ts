import { Hsluv } from "hsluv";
import type { JID } from "@/JID";

/**
 * xep-0392: Consistent Color Generation
 * @see https://xmpp.org/extensions/xep-0392.html
 * @version 1.0.1 (2025-10-03)
 */
export class XEP0392 {
    /** 缓存条目上限，超出后按写入顺序淘汰最旧条目，避免长时间运行下无界增长 */
    static readonly MAX_CACHE_SIZE = 1024;
    static readonly cache = new Map<string, string>();

    /**
     * 对普通字符串（昵称等）生成颜色；输入按原样参与哈希，不做 JID 准备
     * @param s 字符串
     * @returns hex颜色
     */
    static async colorize(s: string) {
        const cached = XEP0392.cache.get(s);
        if (cached !== undefined) {
            return cached;
        }

        // 5.1 角度生成
        // 计算 SHA-1 哈希，返回 Buffer 对象
        const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
        // 将输出视为小端，提取最低有效 16 位（第一个字节是低位，第二个字节是高位）
        const view = new DataView(hash);
        const low16 = view.getUint16(0, true);
        // 归一化到 [0,1] 后映射到 360 度
        const hueAngle = (low16 / 65536) * 360;
        
        // 5.2 RGB 生成
        const hsluv = new Hsluv();
        hsluv.hsluv_h = hueAngle;
        hsluv.hsluv_s = 100;
        hsluv.hsluv_l = 50;
        hsluv.hsluvToHex();
        if (XEP0392.cache.size >= XEP0392.MAX_CACHE_SIZE) {
            XEP0392.cache.delete(XEP0392.cache.keys().next().value!);
        }
        XEP0392.cache.set(s, hsluv.hex);
        return hsluv.hex;
    }

    /**
     * @param jid JID 实例
     * @returns hex颜色
     */
    static colorizeJID(jid: JID): Promise<string> {
        return XEP0392.colorize(jid.toString());
    }
}