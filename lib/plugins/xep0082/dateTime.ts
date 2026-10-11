/**
 * XMPP 日期/时间格式化工具
 *
 * @see https://xmpp.org/extensions/xep-0082.html
 * @version 1.1.1 (2021-08-31)
 */
export class XMPPDateTime {
    /** 合法时区偏移（XSD dateTime 的 timezoneFrag：00:00–13:59，或 14:00） */
    private static readonly OFFSET_REGEX = /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/;

    /**
     * 返回时区字符串对应的分钟偏移
     * @param timeZone - 'Z' 表示 UTC，其余为 '+/-hh:mm'
     * @throws 格式非法时
     */
    private static offsetMinutes(timeZone: string): number {
        if (timeZone === "Z") {
            return 0;
        }
        if (!XMPPDateTime.OFFSET_REGEX.test(timeZone)) {
            throw new Error("无效的时区格式，仅支持 'Z' 或 '+/-hh:mm'");
        }
        const sign = timeZone.startsWith("+") ? 1 : -1;
        const [hours, minutes] = timeZone.slice(1).split(":").map(Number);
        return sign * (hours * 60 + minutes);
    }

    /** 把时刻平移到目标时区，便于随后用 UTC getter 读取"墙上时间" */
    private static toTimeZone(date: Date, timeZone: string): Date {
        return new Date(date.getTime() + XMPPDateTime.offsetMinutes(timeZone) * 60_000);
    }

    /**
     * 将 Date 对象格式化为 CCYY-MM-DD 格式（UTC）
     * @param date - 要格式化的 Date 对象
     * @returns 格式化后的日期字符串
     * @throws 如果输入的不是有效的 Date 对象
     */
    static formatDate(date: Date): string {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError("无效的 Date 对象");
        }
        // 负年份按绝对值补零并保留符号（XSD dateTime 的词法允许前导 '-'）
        const rawYear = date.getUTCFullYear();
        const magnitude = String(Math.abs(rawYear)).padStart(4, "0");
        const year = rawYear < 0 ? `-${magnitude}` : magnitude;
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    /**
     * 将 Date 对象格式化为 CCYY-MM-DDThh:mm:ss[.sss]TZD 格式
     * @param date - 要格式化的 Date 对象
     * @param includeMilliseconds - 是否包含毫秒，默认为 false
     * @param timeZone - 时区定义，'Z' 表示 UTC 或 '+/-hh:mm' 表示偏移
     * @returns 格式化后的日期时间字符串
     * @throws 如果输入的不是有效的 Date 对象或时区无效
     */
    static formatDateTime(
        date: Date,
        includeMilliseconds = false,
        timeZone = "Z"
    ): string {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError("无效的 Date 对象");
        }
        const shifted = XMPPDateTime.toTimeZone(date, timeZone);
        const formattedDate = XMPPDateTime.formatDate(shifted);
        const hours = String(shifted.getUTCHours()).padStart(2, "0");
        const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
        const seconds = String(shifted.getUTCSeconds()).padStart(2, "0");
        const milliseconds = includeMilliseconds
            ? `.${String(shifted.getUTCMilliseconds()).padStart(3, "0")}`
            : "";
        // 零偏移统一输出 XSD 规范形 'Z'（'+00:00'/'-00:00'/'Z' 同值）
        const tz = XMPPDateTime.offsetMinutes(timeZone) === 0 ? "Z" : timeZone;

        return `${formattedDate}T${hours}:${minutes}:${seconds}${milliseconds}${tz}`;
    }

    /**
     * 将 Date 对象格式化为 hh:mm:ss[.sss][TZD] 格式
     * @param date - 要格式化的 Date 对象
     * @param includeMilliseconds - 是否包含毫秒
     * @param timeZone - 时区定义，'Z' 表示 UTC 或 '+/-hh:mm' 表示偏移
     * @returns 格式化后的时间字符串
     * @throws 如果输入的不是有效的 Date 对象或时区无效
     */
    static formatTime(
        date: Date,
        includeMilliseconds = false,
        timeZone = "Z"
    ): string {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError("无效的 Date 对象");
        }
        const shifted = XMPPDateTime.toTimeZone(date, timeZone);
        const hours = String(shifted.getUTCHours()).padStart(2, "0");
        const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
        const seconds = String(shifted.getUTCSeconds()).padStart(2, "0");
        const milliseconds = includeMilliseconds
            ? `.${String(shifted.getUTCMilliseconds()).padStart(3, "0")}`
            : "";
        // 零偏移统一输出 XSD 规范形 'Z'（'+00:00'/'-00:00'/'Z' 同值）
        const tz = XMPPDateTime.offsetMinutes(timeZone) === 0 ? "Z" : timeZone;

        return `${hours}:${minutes}:${seconds}${milliseconds}${tz}`;
    }

    /**
     * 将 CCYYMMDDThh:mm:ss 或 CCYY-MM-DDThh:mm:ss[.sss]TZD 格式的字符串解析为 Date 对象
     *
     * 标准格式的 TZD 为必填（XEP-0082 §3.2），按其时区解释；legacy 紧凑格式按 UTC 解释。
     * 字段越界或格式不匹配时抛出，不做静默滚动。
     * @param dateTimeString - 要解析的日期时间字符串
     * @returns 解析成功的 Date 对象
     * @throws 字符串不符合任一格式或字段越界时抛出
     */
    static parseDateTime(dateTimeString: string): Date {
        const legacyRegex = /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
        const standardRegex =
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;

        let match = legacyRegex.exec(dateTimeString);
        if (match) {
            const [, year, month, day, hours, minutes, seconds] = match;
            return XMPPDateTime.fromUTCComponents(
                Number(year),
                Number(month),
                Number(day),
                Number(hours),
                Number(minutes),
                Number(seconds),
                0
            );
        }

        match = standardRegex.exec(dateTimeString);
        if (match) {
            const [_, year, month, day, hours, minutes, seconds, milliseconds, tzd] =
                match;

            // 亚毫秒截断：直接取小数部分前 3 位，避免 parseFloat 的误差（.505 → 504）
            const ms = milliseconds
                ? Number((milliseconds.slice(1) + "000").slice(0, 3))
                : 0;

            const utc = XMPPDateTime.fromUTCComponents(
                Number(year),
                Number(month),
                Number(day),
                Number(hours),
                Number(minutes),
                Number(seconds),
                ms
            );
            return new Date(
                utc.getTime() - XMPPDateTime.offsetMinutes(tzd) * 60_000
            );
        }

        throw new Error("无效的日期时间字符串");
    }

    /**
     * 按 UTC 用各字段构造 Date，越界字段抛错而非滚动
     * @throws 月不在 1–12、日超出当月天数、时/分/秒超出范围时
     */
    private static fromUTCComponents(
        year: number,
        month: number,
        day: number,
        hours: number,
        minutes: number,
        seconds: number,
        milliseconds: number
    ): Date {
        if (month < 1 || month > 12 || hours > 23 || minutes > 59 || seconds > 59) {
            throw new Error("无效的日期时间字符串");
        }
        if (day < 1 || day > XMPPDateTime.daysInMonth(year, month)) {
            throw new Error("无效的日期时间字符串");
        }

        // setUTCFullYear 按字面值处理 0–99 年，绕开 Date.UTC 的 1900+yy 规则
        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, day);
        date.setUTCHours(hours, minutes, seconds, milliseconds);
        return date;
    }

    /** 返回某年某月的天数（month 取 1–12） */
    private static daysInMonth(year: number, month: number): number {
        const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (
            month === 2 &&
            ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)
        ) {
            return 29;
        }
        return days[month - 1];
    }
}

export default XMPPDateTime;
