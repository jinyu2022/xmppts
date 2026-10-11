# XEP-0424 — 消息撤回

撤回已发送的消息。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0424`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:message-retract:1`。
2. **注册 retraction 解析器** — 解析 `<retract>` / `<retracted>` 元素。
3. **注册 `message:retract` 事件** — 匹配 `retract != null`。

（`<retracted/>` 只出现在归档结果（`<forwarded/>` 内层消息）里，不是广播，所以没有对应的事件。）

## 扩展字段

```typescript
interface Message {
  retract?: { id: string; reason?: string };                               // 收到的撤回请求
  retracted?: { id: string; stamp?: Date; by?: string; reason?: string };  // 归档结果里的撤回标记
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `message:retract` | 收到撤回请求 | `Message & { retract: { id, reason? } }` |

## 公开 API

| 方法 | 说明 |
|------|------|
| `retract(to, id, msgType?, fallbackText?)` | 发送撤回请求，返回该消息元素（`msgType` 默认 `chat`） |
| `XEP0424.NS`（静态） | `"urn:xmpp:message-retract:1"` |
| `XEP0424.parseRetractionEl(el)`（静态） | 解析撤回元素 |
| `XEP0424.createRetractionMessage(to, id, msgType, fallbackText?)`（静态） | 构造撤回消息 |

## 使用示例

```typescript
// 发送撤回请求 → 返回该消息元素（已发送）
client.XEP0424!.retract("friend@example.com", messageId, "chat", "消息已撤回");
```

### 监听他人撤回

```typescript
client.on("message:retract", (message) => {
  console.log("对方撤回了", message.retract.id);
});
```

## 注意事项

- 撤回的 ID 应使用 **XEP-0359 的稳定标识**：群聊用房间分配的 `stanza-id`，单聊用消息 `id`。
- `fallbackText` 可提供给不支持撤回的旧客户端显示。
- 撤回请求只发送一次，服务器不保证一定能撤回。
- 群聊撤回依赖 **XEP-0425**（审核撤回）机制：`<retract/>` / `<retracted/>` 内其它命名空间的子元素（如 `<moderated/>`）会原样转交，由 XEP0425 解析为消息顶层的 `moderated`。
- **`reason` 非规范字段**：XEP0424 的 schema 与正文都没有定义 `<reason/>`，但 XEP0425 §3.1/§4 的通知把它与 `<moderated/>` 一起放在 `<retract/>` / `<retracted/>` 下，故此处一并解析为 `reason` 供上层显示。
- XEP-0424 §3 建议另带 XEP-0428 `<fallback/>` 与 XEP-0334 `<store/>`；本插件暂未实现（代码中已留 TODO），待对应插件建立后统一提供。