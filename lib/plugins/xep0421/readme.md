# XEP-0421 — Occupant Id

半匿名 MUC 中由房间分配的稳定住户标识，用于在昵称变更、重连后识别同一住户。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0421`
- **规范版本**：1.0.1 (2025-04-09)

## 注册后行为

1. 注册消息与出席上的 `<occupant-id/>` 解析器。

不注册专用事件，在 `message` / `presence` 事件中读取 `occupantID` 即可。

本插件不向 disco#info 宣告 `urn:xmpp:occupant-id:0`：该特性表示“房间生成并附加 occupant-id”，客户端宣告会被误解为提供该项能力。

## 扩展字段

```typescript
interface Message {
  occupantID?: { id: string };
}
interface Presence {
  occupantID?: { id: string };
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `hasOccupantIdFeature(room)` | 查询房间 disco#info，判断是否宣告 occupant-id |
| `XEP0421.NS`（静态） | `"urn:xmpp:occupant-id:0"` |

## 使用示例

```typescript
client.on("message", (message) => {
  if (message.occupantID) {
    console.log(message.from.resource, message.occupantID.id);
  }
});

// 使用前确认房间宣告了特性，否则字段可能来自其他住户的伪造
if (await client.XEP0421!.hasOccupantIdFeature("coven@chat.shakespeare.lit")) {
  // 信任 occupantID
}
```

## 注意事项

- 标识是不透明字符串（最长 128 字符），不要尝试解析或反推真实 JID。
- 规范要求仅在房间宣告 `urn:xmpp:occupant-id:0` 时信任该字段（§5）；未宣告时忽略。
- 协议只定义房间如何生成标识，本插件不提供服务端生成逻辑。
