# XEP-0106 — JID 转义

`localpart` 的转义/反转义工具（§3.2、§3.3 映射表），用于把用户输入或非 XMPP 地址（邮箱、LDAP、IRC 等）转成线上 JID，或把线上 JID 还原给用户展示。

- **依赖**：无
- **实例访问**：无（纯静态工具类，不会被注册为插件实例）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，不会被 Connection 加载，也不在 `pluginLoaders` 中登记。

## 扩展字段

无。不直接扩展 stanza。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0106.detect(local)`（静态） | 判断 localpart 是否含未转义的禁止字符（即需要转义）；全部已转义或无需转义时返回 `false` |
| `XEP0106.escapeLocal(local)`（静态） | 转义 localpart；先去除首尾空白（§4.1 第 6 条不允许 `\20` 位于首尾），`\` 优先转成 `\5c` |
| `XEP0106.unescapeLocal(local)`（静态） | 反转义 localpart；`\5c` 最后处理，保证 `\5c20` 还原为 `\20` 而非空格 |

## 使用示例

```typescript
import { XEP0106 } from "@/plugins/xep0106";

XEP0106.escapeLocal("d'artagnan");        // "d\\27artagnan"
XEP0106.unescapeLocal("d\\27artagnan");   // "d'artagnan"

XEP0106.detect("space\\20cadet");         // false：已转义，无需再转义
XEP0106.detect("space cadet");            // true
```

## 注意事项

- 只作用于 `localpart`，不要对 domainpart / resourcepart 调用（§2 要求 1）。
- 不在映射表中的 `\xx` 序列（如 `\2plus\2is\4`、`foo\bar`、`foo\41r`）原样保留（§4.3）。
- 本模块只做字符转换，不校验 JID 合法性；比较两个 JID 时应使用转义形式（§7 安全考虑）。`JID` 类构造时已调用 `detect` / `escapeLocal`（转义后小写映射 + NFC 归一），展示用 `getLocal(true)` / `toString(true)`。
