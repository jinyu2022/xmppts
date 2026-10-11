# XEP-0184 — 消息回执

自动为消息请求送达回执，并自动回复收到的回执请求。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0184`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:receipts`。
2. **注册 receipts 解析器** — 解析 `urn:xmpp:receipts` 命名空间的 `<request/>` / `<received/>` 为 `message.receipts`。
3. **发送拦截** — 给所有含 `<body>` 的 `message` 附加 `<request/>`。
4. **自动回复** — 监听 `message`，收到 `receipts.type === 'request'` 且类型非 `groupchat`/`error` 时，回复 `<received id="..."/>`。

## 扩展字段

```typescript
interface Message {
  receipts?:
    | { type: "request" }                 // 发送方请求回执，无 id
    | { type: "received"; id: string };   // 回执，id 为被回执消息的 id
}
```

## 可监听事件

无专门事件。通过 `message` 事件的 `message.receipts` 字段判断。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0184.NS`（静态） | `"urn:xmpp:receipts"` |
| `XEP0184.parseReceipts(el)`（静态） | 解析 `<request/>`/`<received/>` → `{ receipts }`；命名空间不符、元素名未知或 `<received/>` 缺 `id` 时抛错 |
| `XEP0184.createReceiptsEl(type, id?)`（静态） | 创建回执元素；`received` 必须传 `id`，否则抛错 |

## 使用示例

插件自动在发出的消息上附加 `<request/>` 并自动回复，无需手动调用。判断送达：

```typescript
client.on("message", (message) => {
  if (message.receipts?.type === "received") {
    console.log("对方已送达", message.receipts.id);
  }
});
```

## 注意事项

- **完全自动化**，无需手动调用。
- 接收侧不对 `groupchat`、`error` 类型回复回执；发送侧不区分类型，所有含 `<body>` 的消息都会附加 `<request/>`。
- 判断对方是否已送达：监听 `message` 事件检查 `receipts.type === 'received'`。