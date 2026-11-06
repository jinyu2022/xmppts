# XEP-0444 — Message Reactions

消息反应：用 `<reactions id="..."><reaction>👋</reaction></reactions>` 对消息作出反应。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0444`
- **规范版本**：0.2.1 (2024-04-15)

## 注册后行为

1. 向 XEP-0030 添加 `urn:xmpp:reactions:0` 特性。
2. 注册 `<reactions/>` 解析器。

不注册专用事件，在 `message` 事件中读取 `message.reactions` 即可。

## 扩展字段

```typescript
interface Message {
  reactions?: {
    id: string;          // 被反应消息的 ID
    values: string[];    // 去重后的反应；空数组表示移除全部
  };
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `sendReactions(to, messageId, values, type, store?)` | 发送完整反应集合；空集合表示移除全部 |
| `XEP0444.createReactionsEl(id, values)`（静态） | 创建 `<reactions/>`，重复值只保留一个 |
| `XEP0444.createReactionsMessage(to, id, values, type, store?)`（静态） | 创建带反应的消息 |
| `XEP0444.NS`（静态） | `"urn:xmpp:reactions:0"` |

## 使用示例

```typescript
// 1:1：对收到的消息加反应
client.XEP0444!.sendReactions(
  "romeo@capulet.net/orchard",
  "744f6e18-a57a-11e9-a656-4889e7820c76",
  ["👋"],
  "chat",
);

// 群聊：id 必须是房间分配的 stanza-id（XEP-0359）
client.XEP0444!.sendReactions(
  "coven@chat.shakespeare.lit",
  "39K7ZYIp",
  ["👋", "🐢"],
  "groupchat",
);

// 移除全部反应
client.XEP0444!.sendReactions(to, messageId, [], "chat");
```

## 注意事项

- 每次发送的都是完整集合，不是增量；更新时要把仍适用的旧反应一起带上（§3.2）。
- 群聊消息必须引用房间分配的 stanza-id，不能使用发送方自选的 `id`（§4.2）。
- 解析时忽略重复反应与空反应；缺少 `id` 的 `<reactions/>` 会被忽略并记录警告，不影响消息正文。emoji 合法性不在解析层校验（TODO：§4 要求能显示为单个 emoji），当前只过滤空串，接收方可以忽略不合规的 codepoint。
- 1:1 场景只接受来自对话双方 bare JID 的反应，群聊场景按房间内的 occupant 校验发送者；解析层不判断会话关系，由应用层完成。
- 默认附加 XEP-0334 `<store/>` 提示；原消息带 `<no-store/>` 时应传 `store = false`。
