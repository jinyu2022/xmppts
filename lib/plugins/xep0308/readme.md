# XEP-0308 — 消息更正

更正已发送的消息（通过 `<replace/>` 指向原消息 ID）。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0308`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:message-correct:0`。
2. **注册 replace 解析器** — 解析 `<replace id="..."/>` 为 `message.replace`。
3. **注册 `message:correct` 事件** — 匹配 `replace != null` 且 `type !== "error"`。

## 扩展字段

```typescript
interface Message {
  replace?: { id: string };   // 被更正的原消息 ID
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `message:correct` | 收到带 `<replace>` 的消息 | `Message & { replace: { id } }` |

事件只表示「消息里带 `<replace/>`」，**不校验来源**。XEP-0308 只允许发送者更正自己发出的消息，而插件拿不到原消息上下文，所以**调用方必须自行比对**原消息的发送者（1:1 用 bare JID，匿名 MUC 用 XEP-0421 occupant-id）后才能替换本地内容。

已排除 `type="error"` 的回执：RFC 6120 §8.3.1 允许错误回执回显原 payload，否则会把退回的 `<replace/>` 当成新更正。

## 公开 API

| 方法 | 说明 |
|------|------|
| `correctMessage(to, replaceId, newBody, type?)` | 发送更正消息（type 默认 `chat`） |
| `correctMessage(originalMessage, newBody)` | 基于原 Message 自动提取 `to`/`type`/`id` |
| `XEP0308.isCorrection(msg)`（静态） | 检查消息是否含 `<replace/>`（类型收窄） |
| `XEP0308.NS`（静态） | `"urn:xmpp:message-correct:0"` |
| `XEP0308.createReplaceEl(id)`（静态） | 创建 `<replace/>` |
| `XEP0308.createCorrectionMessageEl(to, replaceId, newBody, type)`（静态） | 构造完整的更正消息 |

## 使用示例

```typescript
// 基于原消息自动提取 to/type/id（→ void）
client.XEP0308!.correctMessage(originalMessage, "更正后的内容");

// 或显式指定收件人、原消息 ID 与类型（type 默认 "chat"）
client.XEP0308!.correctMessage("friend@example.com", originalId, "更正后的内容");
```

### 监听他人更正

```typescript
client.on("message:correct", (message) => {
  console.log("更正了消息", message.replace.id, message.body);
});
```

## 注意事项

- 更正消息本身也应有唯一 `id`，以便后续再次更正。
- 多次更正都应指向**原始消息**的 `id`，而非上一次更正消息的 `id`。
- 更正只应改变 `<body>`，不应改变 stanza 类型或元数据。
