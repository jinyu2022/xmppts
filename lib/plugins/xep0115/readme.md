# XEP-0115 — 实体能力

基于哈希公布自身能力，并解析他人 presence 中的能力声明。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0115`

## 可配置项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `node` | `string` | `http://xmppts.chat` | 实体能力节点标识（§4.1）。对端用它拼成 `node#ver` 查询 disco#info，应在各版本间保持稳定且不能包含 `#` |

哈希算法固定 `sha-1`。注册时通过第二个参数传入：

```typescript
client.registerPlugin("XEP0115", { node: "urn:xmppts:caps" });
```

## 注册后行为

`init()` 执行以下动作：

1. **声明支持 caps** — 调用 `XEP0030.addFeature("http://jabber.org/protocol/caps")`，使本端 disco#info 自称支持 caps（§7 要求 MUST）。
2. **注册 caps 解析器** — 解析命名空间 `http://jabber.org/protocol/caps` 的 `<c/>`，运行时得到 `presence.cap`。
3. **发送拦截** — 在发送管线中为所有 `presence` 附加自身 `<c/>`（仅 `selfCaps` 就绪后）。
4. **监听 presence** — 当前为空实现（`ver → capabilities` 映射表尚未实现）：收到他人 `<c/>` 只解析出 `{node, ver, hash}`，不发起 disco#info、不校验 `hash`、不入缓存。
5. **生成自身能力** — `connect` 时基于 XEP-0030 的 `identities`/`features` 计算 `ver`，生成自身 `<c/>`（`dataForm` 未接入，见「注意事项」）。

## 扩展字段

```typescript
interface Presence {
  cap?: { node: string; ver: string; hash: string };  // 注意字段名是 cap，不是 caps
}
```

> 该字段为运行时注入，尚无 `declare module` 类型声明。

## 可监听事件

无专门事件。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0115.NS`（静态） | `"http://jabber.org/protocol/caps"` |
| `XEP0115.parseCaps(el)`（静态） | 解析 `<c/>` → `{ cap: Capabilities }`；命名空间不符抛 `Error` |
| `XEP0115.generateCapsVerification(identities, features, dataForm?)`（静态） | 生成 SHA-1 Base64 的 `ver` → `Promise<string>` |
| `XEP0115.createCapsElement(caps)`（静态） | 由 `{ node, ver, hash }` 创建 `<c/>` → `XMPPElement`；`hash` 当前无条件输出（可能为 `null`） |

## 使用示例

静态方法经类本身调用：

```typescript
import XEP0115 from "@/plugins/xep0115";

// 解析他人 presence 中的 <c/> → { cap: Capabilities }；命名空间不符抛 Error
const { cap } = XEP0115.parseCaps(cEl);

// 生成自身 ver（SHA-1 Base64）→ Promise<string>
const ver = await XEP0115.generateCapsVerification(identities, features);

// 创建 <c/> 元素 → XMPPElement
const cEl = XEP0115.createCapsElement({ node: "http://xmppts.chat", ver, hash: "sha-1" });
```

## 注意事项

- 自身能力哈希在 `onSessionBound`（每次会话绑定）时生成，每个新会话都按当时的 `identities`/`features` 重算，结果写入 `selfCaps` 后在 presence 发送时附加；若同一会话内又动态 `addFeature`，已生成的 `ver` 会过期（§6.1：特性变化 MUST 重算、SHOULD 重发 presence）。
- `ver → capabilities` 映射表尚未实现（TODO），无法据他人 `ver` 反查其能力；对方 presence 里的 caps 信息事实上被丢弃。
- 发送拦截器会在所有 presence 上附加 `<c/>`（含定向与 MUC presence，§6.1/§8.3 允许）。
- `generateCapsVerification` 会**原地排序**传入的 `features` 数组（`identities` 则先拷贝），调用方复用同一数组时注意。
- `parseCaps` 把 `node`/`ver`/`hash` 一律断言为 `string`：缺 `hash` 的 legacy `<c/>`（§13）也能解析，但此时 `ver` 是不透明字符串，不能按哈希校验。
- 排序用 `localeCompare`（features/字段）/UTF-16 `<`（identities），均与 §5.1 要求的 UTF-8 字节序不完全一致，理论上可能算出与其他客户端不同的 `ver`。
- 本插件不涉及 `ext`（§4 表 1 已标 DEPRECATED）。