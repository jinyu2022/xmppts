/**
 * XEP-0426: Character counting in message bodies
 *
 * JavaScript 字符串以 UTF-16 码元索引，`length` 与 `slice` 会把代理对
 * （如 emoji）算作两个单位，与规范要求的码点不一致，因此不能用它们
 * 计算偏移。
 *
 * @see https://xmpp.org/extensions/xep-0426.html
 * @version 0.3.0 (2022-12-27)
 */
export class XEP0426 {
    /**
     * 按 Unicode 码点计数
     *
     * 组合字符（如 `e` + U+0301）按多个码点计，不合并为字素簇。
     * @param text 待计数的字符串
     */
    static length(text: string): number {
        return Array.from(text).length;
    }

    /**
     * 码点偏移 → UTF-16 索引，用于 `slice` 等字符串操作
     * @param text 原字符串
     * @param offset 码点偏移，从 0 开始；超出长度时返回字符串末尾索引
     */
    static toUtf16Index(text: string, offset: number): number {
        let index = 0;
        let count = 0;
        for (const char of text) {
            if (count >= offset) break;
            index += char.length;
            count += 1;
        }
        return index;
    }

    /**
     * UTF-16 索引 → 码点偏移
     * @param text 原字符串
     * @param index UTF-16 索引；落在代理对中间时向上取整到码点边界
     */
    static toCodePointOffset(text: string, index: number): number {
        let utf16 = 0;
        let offset = 0;
        for (const char of text) {
            if (utf16 >= index) break;
            utf16 += char.length;
            offset += 1;
        }
        return offset;
    }
}

export default XEP0426;
