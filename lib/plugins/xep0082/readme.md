# XEP-0082 — 日期/时间格式化

按 XMPP Date/Time Profiles 格式化与解析日期的工具函数。

- **依赖**：无
- **实例访问**：无（纯静态工具类，直接 `import { XMPPDateTime }`）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，不会被 Connection 加载，由调用方直接 import 使用。

## 扩展字段

不扩展 stanza。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 | 输出格式 |
|------|------|---------|
| `formatDate(date)` | 日期 | `2024-09-17` |
| `formatDateTime(date, includeMilliseconds?, timeZone?)` | 完整日期时间 | `2024-09-17T14:30:45Z` |
| `formatTime(date, includeMilliseconds?, timeZone?)` | 仅时间 | `14:30:45Z` |
| `parseDateTime(dateTimeString)` | 解析 ISO 8601 字符串 | `Date` |

### 参数

- `includeMilliseconds` — 是否含毫秒（默认 false），输出 `.sss`
- `timeZone` — 时区：`'Z'`（默认）或 `'+08:00'` / `'-05:00'`；非 `'Z'` 时按该偏移做真实换算；零偏移统一输出 `Z`

## 使用示例

```typescript
import { XMPPDateTime } from "@/plugins/xep0082/dateTime";

// 以下格式化方法均返回 string
XMPPDateTime.formatDate(new Date());                  // "2024-09-17"
XMPPDateTime.formatDateTime(new Date(), true);        // 含毫秒
XMPPDateTime.formatTime(new Date(), false, "+08:00"); // 按时区换算

// 解析 → Date；格式非法时抛 Error
const date = XMPPDateTime.parseDateTime("2024-09-17T14:30:45Z");
```

## 注意事项

- 所有输出遵循 ISO 8601 / XMPP Date/Time Profiles；默认按 UTC 取数并输出 `Z`；传 `'+00:00'`/`'-00:00'` 时归一为规范形 `Z`（XSD：`Z` 是零偏移的规范表示）。
- `parseDateTime` 标准格式要求 `Z`/偏移（缺 TZD、字段越界、小写 `z` 均抛错）；legacy `CCYYMMDDThh:mm:ss` 按 UTC 解释。
- 三个 `format*` 方法传入非 `Date`/无效 `Date` 抛 `TypeError("无效的 Date 对象")`，`timeZone` 非法抛 `Error`；`timeZone` 合法范围与 XSD 一致（`00:00`–`13:59` 或 `14:00`）。
- `parseDateTime` 的秒小数按截断取前 3 位（`.505` → 505ms，`.9999999` → 999ms），不四舍五入。
- 解析侧只覆盖完整 dateTime：没有 `parseDate`/`parseTime`，`formatDate`/`formatTime` 的输出需自行拼接后解析。
- 字段越界一律抛错、不做静默滚动，故有意拒绝 `24:00:00` 与闰秒 `:60`；若需按 XSD 接受 `24:00:00`，调用方须自行归一为次日 `00:00:00`。
- 年份范围不对称：格式化支持负年份与超过 4 位的年份，`parseDateTime` 只收 4 位无符号年（`0000` 可解析）。
- `parseDateTime` 失败时抛 `Error` 而非返回 `null`，调用方（XEP-0203 / XEP-0424 等）需自行捕获。
- 被 XEP-0203（延迟投递）和 XEP-0424（消息撤回）使用。