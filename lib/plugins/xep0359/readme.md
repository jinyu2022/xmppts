# XEP-0359 — 唯一且稳定的节 ID

识别服务器/发送者分配的唯一稳定 ID。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0359`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:sid:0`。
2. **注册解析器** — 把 `<stanza-id>` / `<origin-id>` / `<referenced-stanza>` 解析为 `message.stanzaID` / `message.originID` / `message.referencedStanza`。

## 扩展字段

```typescript
interface Message {
  stanzaID?: { id: string; by?: string };          // 服务器分配
  originID?: { id: string; by?: string };          // 发送者分配
  referencedStanza?: { id: string; by?: string };  // 被引用节
}
```

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0359.parseStanzaId(el)`（静态） | 解析 `stanza-id` / `origin-id` / `referenced-stanza` → `{ stanzaID \| originID \| referencedStanza: { id, by? } }`；命名空间不符抛 `Error` |
| `XEP0359.createOriginId(id?)`（静态） | 创建 `<origin-id/>`，`id` 缺省时随机生成 |
| `XEP0359.NS`（静态） | `"urn:xmpp:sid:0"` |

> `parseStanzaId` / `createOriginId` / `NS` 实际定义于 `StanzaID` 基类（`XEP0359 extends StanzaID`）。

## 使用示例

```typescript
import XEP0359 from "@/plugins/xep0359";

// 收到的消息会自动填充同名字段
client.on("message", (message) => {
  console.log(message.stanzaID?.id, message.originID?.id);
});

// 需要时自行给发出的消息附加唯一 ID（→ XMPPElement）
const originIdEl = XEP0359.createOriginId();
```

## 注意事项

- **自动解析**：收到的 `<stanza-id>` / `<origin-id>` 会直接映射到 `message` 的同名字段；也可手动调用 `parseStanzaId()`。
- **不自动生成**：插件不会给发出的消息追加 `<origin-id>`。§2.2 只在"某些需要由发起方生成 ID 的场景"要求使用，需用时由调用方拿 `createOriginId()` 自行附加；`stanza-id` 由服务器或房间等生成方补齐。
- 三种元素：`<stanza-id>`（服务器分配）、`<origin-id>`（发送者分配）、`<referenced-stanza>`（被引用节）。
- `by` 为分配该 ID 的实体；规范 §3.7 要求其值为规范化 XMPP 地址、§3.5 规定 `stanza-id` 的 `by` 必填（本库类型暂标为可选）。同一节上同名多元素时后解析者覆盖前者。