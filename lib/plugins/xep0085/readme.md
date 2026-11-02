# XEP-0085 — Chat State Notifications

通过消息上的 `<active/>`、`<composing/>` 等元素通知对话状态（输入中、暂停、离开等）。


- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0085`
- **规范版本**：2.1（2009-09-23）

## 注册后行为

1. 向 XEP-0030 添加 `http://jabber.org/protocol/chatstates` 特性。
2. 注册聊天状态解析器，解析结果写入 `message.chatState`。

不注册专用事件，在常规 `message` 事件里读取 `message.chatState` 即可。

## 扩展字段

```typescript
type ChatStateValue = "active" | "inactive" | "gone" | "composing" | "paused";

interface Message {
  chatState?: ChatStateValue;
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `sendChatState(to, state, type?)` | 发送独立的状态通知，默认 `type = "chat"` |
| `XEP0085.createChatStateEl(state)`（静态） | 创建状态元素，可附加到自己的消息上 |
| `XEP0085.createChatStateMessage(to, state, type?)`（静态） | 创建只含状态的消息 |
| `XEP0085.NS` / `XEP0085.STATES`（静态） | 命名空间与全部状态 |

## 使用示例

```typescript
// 输入中
client.XEP0085!.sendChatState("romeo@montague.lit", "composing");

// 停止输入
client.XEP0085!.sendChatState("romeo@montague.lit", "paused");

// 内容消息附带 active 状态（规范推荐）
const msg = Message.createMessage("romeo@montague.lit", "Hi");
msg.appendChild(XEP0085.createChatStateEl("active"));
client.send(msg);

// 收到时读取
client.on("message", (message) => {
  if (message.chatState) console.log(message.chatState);
});
```

## 注意事项

- 一条消息最多携带一个状态元素（§5.1）。
- 同一命名空间下的未知状态元素会被忽略并记录警告，不影响消息正文与其他扩展。
- 连续输入时不要重复发送同一个独立通知；内容消息应附带 `<active/>`，且不应附带其他状态（§5.1）。
- 群聊中不应发送 `<gone/>`，收到其他住户的 `<gone/>` 也应忽略（§5.1）；插件只解析，不代为过滤。
- 状态通知可能暴露用户的交互情况，规范要求客户端提供关闭开关（§7）；是否发送由应用层决定。
