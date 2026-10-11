/**
 * XEP-0106: JID Escaping
 *
 * localpart 的转义/反转义（§3.2、§3.3 映射表）：把用户输入或非 XMPP 地址转成线上 JID，
 * 或把线上 JID 还原后展示给用户。仅作用于 localpart，不得作用于 domainpart / resourcepart（§2 要求 1）。
 *
 * 纯静态工具类：不实现 Plugin 接口，不会被 Connection 加载，也不登记在 plugins barrel。
 * @see https://xmpp.org/extensions/xep-0106.html
 * @version 1.1.1 (2016-07-08)
 */
export class XEP0106 {
    /** §3.2 表：localpart 中需要转义的字符 → 转义序列 */
    private static readonly ESCAPE_MAP: Readonly<Record<string, string>> = {
        "\\": String.raw`\5c`,
        " ": String.raw`\20`,
        '"': String.raw`\22`,
        "&": String.raw`\26`,
        "'": String.raw`\27`,
        "/": String.raw`\2f`,
        ":": String.raw`\3a`,
        "<": String.raw`\3c`,
        ">": String.raw`\3e`,
        "@": String.raw`\40`,
    };

    /** §3.3 表：转义序列 → 未转义字符（大小写敏感，仅认小写） */
    private static readonly UNESCAPE_MAP: Readonly<Record<string, string>> = {
        [String.raw`\20`]: " ",
        [String.raw`\22`]: '"',
        [String.raw`\26`]: "&",
        [String.raw`\27`]: "'",
        [String.raw`\2f`]: "/",
        [String.raw`\3a`]: ":",
        [String.raw`\3c`]: "<",
        [String.raw`\3e`]: ">",
        [String.raw`\40`]: "@",
        [String.raw`\5c`]: "\\",
    };

    /** localpart 中需要转义的字符，与 ESCAPE_MAP 的键一致 */
    private static readonly PLAIN_CHARS = /[ "&'/:<>@\\]/g;

    /** 同 PLAIN_CHARS，供 `test()` 使用（不带 /g，避免 lastIndex 状态残留） */
    private static readonly HAS_PLAIN_CHAR = /[ "&'/:<>@\\]/;

    /** 合法的转义序列，与 UNESCAPE_MAP 的键一致 */
    private static readonly ESCAPED_SEQS =
        /\\(?:20|22|26|27|2f|3a|3c|3e|40|5c)/g;

    /**
     * 判断 localpart 是否需要转义：去掉其中已存在的转义序列后，是否仍残留需转义字符
     * @param local 待判断的 localpart
     */
    static detect(local: string): boolean {
        return XEP0106.HAS_PLAIN_CHAR.test(
            local.replace(XEP0106.ESCAPED_SEQS, ""),
        );
    }

    /**
     * 转义 localpart
     * @param local 用户输入等未转义的 localpart；首尾空白会被去除（§4.1 第 6 条不允许 `\20` 位于首尾）
     */
    static escapeLocal(local: string): string {
        return local
            .trim()
            .replace(
                XEP0106.PLAIN_CHARS,
                (char) => XEP0106.ESCAPE_MAP[char] ?? char,
            );
    }

    /**
     * 反转义 localpart；不在映射表中的 `\xx` 序列原样保留（§4.3）
     * @param local 线上的 localpart
     */
    static unescapeLocal(local: string): string {
        return local.replace(
            XEP0106.ESCAPED_SEQS,
            (seq) => XEP0106.UNESCAPE_MAP[seq] ?? seq,
        );
    }
}
