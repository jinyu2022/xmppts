# XEP-0461 — Message Replies

消息回复：用 `<reply to="..." id="..."/>` 指向被回复的消息。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0461`
- **规范版本**：0.2.1 (2026-02-25)

## 注册后行为

1. 向 XEP-0030 添加 `urn:xmpp:reply:0` 特性。
2. 注册 `<reply/>` 解析器。

不注册专用事件，在 `message` 事件中读取 `message.reply` 即可。

## 扩展字段

```typescript
interface Message {
  reply?: {
    id: string;      // 被回复消息的 ID
    to?: string;     // 被回复消息作者的 JID（规范只要求 SHOULD）
  };
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `reply(originalMessage, body, quote?)` | 从原消息推断收件人、引用目标、被引用 ID 与消息类型；`quote` 为 `true` 时加入引用块与 XEP-0428 回退 |
| `sendReply(to, replyTo, replyId, body, type?)` | 显式指定引用目标 |
| `XEP0461.createReplyEl(to, id)`（静态） | 创建 `<reply/>` |
| `XEP0461.createReplyMessage(to, replyEl, body, type, quotedBody?)`（静态） | 用给定的 `<reply/>` 创建回复消息；提供 `quotedBody` 时在正文前插入引用块并附加 XEP-0428 回退 |
| `XEP0461.getReferenceEl(message)`（静态） | 按 §3.1 规则从原消息构造 `<reply/>` |
| `XEP0461.NS` / `XEP0461.FALLBACK_NS`（静态） | `"urn:xmpp:reply:0"` / `"urn:xmpp:fallback:0"` |

## 使用示例

```typescript
// 自动推断（1:1）：发给发送者，引用其 origin-id 或 id
client.XEP0461!.reply(receivedMessage, "Great idea!");

// 需要给旧客户端看的引用预览（含 XEP-0428 回退）
client.XEP0461!.reply(receivedMessage, "Great idea!", true);

// 自动推断（群聊）：发给房间 bare JID，引用房间分配的 stanza-id
client.XEP0461!.reply(groupchatMessage, "同意");

// 显式指定
client.XEP0461!.sendReply(
  "anna@example.com",
  "anna@example.com/tablet",
  "message-id1",
  "Great idea!",
);
```

## 注意事项

- 群聊消息必须引用房间分配的 `<stanza-id/>`（XEP-0359），不能用 stanza 自带的 `id`；没有 stanza-id 的群聊消息无法回复（§3.1）。
- 其他类型优先使用 `<origin-id/>`，没有时才回退到 `id`。
- 引用回退（XEP-0428）默认关闭；`quote = true` 时把原消息正文逐行加上 `> ` 前缀，并生成 `<fallback for="urn:xmpp:reply:0"><body start="0" end="…"/></fallback>`。`end` 按 Unicode 码点计算（XEP-0426），不是 UTF-16 长度。
