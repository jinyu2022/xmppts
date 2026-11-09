# XEP-0333 — Displayed Markers

已显示标记（俗称已读回执）：发送方用 `<markable/>` 请求，接收方用 `<displayed/>` 回应。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0333`
- **规范版本**：1.0.0 (2024-04-17)

## 注册后行为

1. 向 XEP-0030 添加 `urn:xmpp:chat-markers:0` 特性。
2. 注册 `<markable/>`、`<displayed/>` 解析器。

不注册专用事件，在 `message` 事件中读取 `message.markable` / `message.displayed` 即可。

## 扩展字段

```typescript
interface Message {
  markable?: true;                    // 发送方请求已读标记
  displayed?: { id: string };         // 已显示标记，id 为被显示消息的 ID
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `sendDisplayed(to, id, type)` | 发送已读标记；`type` 应与原始消息一致，群聊用 `groupchat` |
| `XEP0333.createMarkableEl()`（静态） | 创建 `<markable/>`，附加到待发送消息上 |
| `XEP0333.createDisplayedEl(id)`（静态） | 创建 `<displayed/>` |
| `XEP0333.createDisplayedMessage(to, id, type)`（静态） | 创建只含 `<displayed/>` 的消息，`type` 由调用方指定 |
| `XEP0333.NS`（静态） | `"urn:xmpp:chat-markers:0"` |

## 使用示例

```typescript
// 让对端知道这条消息已被显示（1:1）
client.XEP0333!.sendDisplayed("romeo@montague.lit", message.id!, "chat");

// 群聊：id 必须是房间分配的 stanza-id（XEP-0359）
client.XEP0333!.sendDisplayed("coven@chat.shakespeare.lit", "39K7ZYIp", "groupchat");

// 请求对端发送已读标记
const msg = Message.createMessage("romeo@montague.lit", "Hi");
msg.appendChild(client.XEP0333!.createMarkableEl());
client.send(msg);
```

## 注意事项

- 附加 `<markable/>` 的消息必须带 `id` 属性（§4.1）；通过 `connection.send` 发送时框架会自动补，自行构造元素时要留意。
- 群聊消息必须引用房间分配的 stanza-id，不能使用发送方自选的 `id`（§4.3）。
- 已读标记只表示“截至此消息”，不要为每条消息分别发送。
- 不要以已读标记回应已读标记，以免形成循环（§4.2）。
- 从 carbons（XEP-0280）或 MAM（XEP-0313）回显的、自己发出的消息不要回标记（§5.3）。
- 1:1 聊天中对方未请求时主动发送标记不推荐（§5.4）。
- 群聊中要定位当前参与者，应使用 real JID（非匿名房间）或 XEP-0421 的 occupant-id（§7）。
- 只向有权查看本端 presence 的实体发送 `<displayed/>`（§7）。
- 已读回执并非所有用户都愿意开启，客户端应提供开关（§8）。
