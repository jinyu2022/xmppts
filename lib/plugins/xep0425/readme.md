# XEP-0425 — 审核消息撤回

MUC 审核员撤回房间内其他用户的消息。

- **依赖**：XEP-0030（服务发现）、XEP-0424（消息撤回）
- **实例访问**：`connection.XEP0425`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 moderation 解析器** — 解析 `urn:xmpp:message-moderate:1` 的 `<moderate>` / `<moderated>` 元素。审核通知里的 `<moderated/>` 由 XEP0424 的转换器从 `<retract/>` / `<retracted/>` 内原样转交过来。
2. **注册 `message:moderated` 事件** — 匹配 `moderated != null`。

> 向 disco 注册审核特性的代码已注释（群聊才需要，客户端不需要）。

## 扩展字段

```typescript
interface Message {
  moderated?: { by?: string; reason?: string };   // reason 运行时由 XEP0424 的 <retract/> 提供，见 message.retract.reason
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `message:moderated` | 消息被审核员撤回 | `Message & { moderated: { by?; reason? } }` |

## 公开 API

| 方法 | 说明 |
|------|------|
| `moderate(to, id, reason?)` | 发送审核撤回请求（同步发送，返回 IQ 元素） |
| `moderateAsync(to, id, reason?)` | 异步发送并等待服务器结果 → `Promise<...>` |
| `XEP0425.NS`（静态） | `"urn:xmpp:message-moderate:1"` |
| `XEP0425.createModerationEl(id, reason?)`（静态） | 创建审核元素 |
| `XEP0425.createModeratedEl(by?)`（静态） | 创建 `<moderated/>` 标记元素；`<reason/>` 需调用方作为兄弟追加 |

## 使用示例

```typescript
// 同步发送（返回 IQ 元素），发往 MUC 服务
client.XEP0425!.moderate("room@conference.example.com", stanzaId, "违规内容");

// 异步发送并等待服务器结果 → Promise<...>（失败抛 XMPPError）
await client.XEP0425!.moderateAsync("room@conference.example.com", stanzaId, "违规内容");
```

### 监听消息被审核

```typescript
client.on("message:moderated", (message) => {
  console.log("被撤回", message.moderated?.by, message.retract?.reason);
});
```

## 注意事项

- 审核请求发送给 **MUC 服务**，不是用户。
- 需使用 MUC 分配的 **XEP-0359 stanza-id**。
- 审核员需要 moderator 或 admin 角色。
- `moderateAsync()` 返回 Promise，失败时抛异常。
- **来源校验**：§5 要求只有来自 MUC 服务本身的审核消息才可信；当前 matcher 只判 `moderated != null`，未校验 `from`，消费方需自行确认。
- **`reason` 归属**：§3.1 中 `<reason/>` 与 `<moderated/>` 平级（属 `<retract/>` / `<retracted/>` 的子元素），由 **XEP0424** 解析为 `message.retract.reason` / `message.retracted.reason`（XEP0424 的 schema 未定义该子元素，属实际互通做法）；本插件只解析 `<moderated/>` 的 `by`，`createModeratedEl` 也只生成 `<moderated/>`，`<reason/>` 由调用方作为兄弟追加。