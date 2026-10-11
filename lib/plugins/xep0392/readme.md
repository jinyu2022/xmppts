# XEP-0392 — 一致性颜色生成

由任意字符串确定性地生成颜色，用于为 JID/昵称生成固定头像背景色。

- **依赖**：无
- **实例访问**：无（纯静态类，直接 `import { XEP0392 }` 使用，无需注册）

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
| `XEP0392.colorize(s)`（静态） | 字符串 → `Promise<string>`（hex 颜色）；输入按原样参与哈希 |
| `XEP0392.colorizeJID(jid)`（静态） | `JID` 实例 → `Promise<string>`；基于 JID 准备后的形式着色；字符串输入请用 `colorize()` |
| `XEP0392.cache`（静态） | `Map<string, string>` 结果缓存，上限 `XEP0392.MAX_CACHE_SIZE`（超出按写入顺序淘汰最旧条目） |

## 使用示例

```typescript
import { XEP0392 } from "@/plugins/xep0392";
import { JID } from "@/JID";

// 昵称等任意字符串；同一输入永远返回同色
const color = await XEP0392.colorize("some nickname");

// JID 实例：构造时已完成 §6.2 准备，大小写等价的 localpart/domainpart 得到同色
const jidColor = await XEP0392.colorizeJID(new JID("Romeo@Example.com/Phone"));
```

## 注意事项

- 同一输入**永远返回同一颜色**（确定性算法）。
- 算法：SHA-1 → 取低 16 位映射到 [0, 360] 色相 → 固定饱和度 100、亮度 50 → HSLuv 转 RGB Hex。
- 典型用途为 JID/昵称生成固定配色；依赖 `hsluv` 库。
- 饱和度 100、亮度 50 是本实现的取值（§5.2 不强制），与 §13 测试向量前提一致。
- JID 输入使用 `colorizeJID()`，仅接受 `JID` 实例（字符串请用 `colorize()`）：基于构造时完成的 JID 准备（localpart/domainpart 大小写折叠与 NFC 归一，resourcepart 保留大小写）着色。
- `colorize()` 对字符串按原样参与哈希，同一 JID 的不同大小写写法会得到不同颜色。
- §5.3/§5.4 的受限调色板映射未实现。