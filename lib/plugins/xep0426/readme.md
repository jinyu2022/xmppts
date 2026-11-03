# XEP-0426 — 正文中的字符计数

规定消息正文里的位置如何计数：按 Unicode 码点，而不是 UTF-16 码元或字素簇。XEP-0428 的 `<fallback/>` 区间等即以码点表达偏移。

- **依赖**：无
- **实例访问**：无（纯静态类，直接 `import { XEP0426 }` 使用，无需注册）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，无需 `init()` 与注册；直接导入后调用静态方法即可。

## 扩展字段

不扩展 stanza。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0426.length(text)`（静态） | 按 Unicode 码点计数；组合字符按多个码点计，不合并为字素簇 |
| `XEP0426.toUtf16Index(text, offset)`（静态） | 码点偏移 → UTF-16 索引，供 `slice` 等字符串操作使用；偏移超出长度时返回末尾索引 |
| `XEP0426.toCodePointOffset(text, index)`（静态） | UTF-16 索引 → 码点偏移；索引落在代理对中间时向上取整到码点边界 |

> JavaScript 的 `String.prototype.length` 与 `slice` 以 UTF-16 码元为单位，emoji 等代理对会被算作两个单位，不能直接用于本规范的偏移。

## 使用示例

```typescript
import { XEP0426 } from "@/plugins/xep0426";

XEP0426.length("Hello, world!"); // 13
XEP0426.length("😀"); // 1（".length" 为 2）

const text = "a😀b";
XEP0426.toUtf16Index(text, 2); // 3 → text.slice(0, 3) === "a😀"
XEP0426.toCodePointOffset(text, 3); // 2
```
