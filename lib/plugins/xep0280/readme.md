# XEP-0280 — 消息碳副本（Message Carbons）

让同一账号的多个客户端同步收发到的消息。

- **依赖**：XEP-0030（服务发现）、XEP-0297（节转发）
- **实例访问**：`connection.XEP0280`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:carbons:2`。
2. **自动启用** — 会话开始后经 `getServerFeatures()` 查询，服务器支持则调用 `enable()`，否则 warn。
3. **注册 carbon 解析器** — 解析 message 中的 `<received/>` / `<sent/>` 为 `message.carbon`。
4. **注册事件** — `carbon:received` 与 `carbon:sent`。

## 扩展字段

```typescript
interface Message {
  readonly carbon?: {
    type: "received" | "sent";
    forwarded: Forwarded;   // 来自 XEP-0297
  };
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `carbon:received` | 其他客户端收到的消息 | `Message & { carbon: { type: "received" } }` |
| `carbon:sent` | 其他客户端发出的消息 | `Message & { carbon: { type: "sent" } }` |

两个事件均校验来源（XEP-0280 §11）：仅当包装消息 `from` 的 bare JID 等于本账号 bare JID 时触发，不符则忽略并 warn。

## 公开 API

| 方法 | 说明 |
|------|------|
| `enable()` | 发送启用碳副本的 IQ |
| `disable()` | 发送停用碳副本的 IQ |
| `XEP0280.NS`（静态） | `"urn:xmpp:carbons:2"` |
| `XEP0280.parseCarbonEl(el)`（静态） | 解析 `<received/>` / `<sent/>` → `{ carbon }` |
| `XEP0280.createEnableIq()` / `createDisableIq()`（静态） | 构造启用/停用 IQ |

## 使用示例

服务器支持时 `init()` 已自动启用，一般无需手动调用：

```typescript
// → Promise<boolean>（服务器应答 result 为 true）
await client.XEP0280!.enable();
await client.XEP0280!.disable();
```

### 监听碳副本

```typescript
client.on("carbon:received", (message) => {
  console.log("其他客户端收到", message.carbon!.forwarded);
});

client.on("carbon:sent", (message) => {
  console.log("其他客户端发出", message.carbon!.forwarded);
});
```

## 注意事项

- 服务器支持时自动启用，通常无需手动调用 `enable()`。
- 碳副本消息中同时存在 XEP-0297 解析出的 `message.forwarded`。
- 服务器不支持时打印 warn，不影响正常通信。
- §11 要求 carbon 必须来自本人 bare JID：两个 matcher 均已校验包装消息的 `from`，不符或缺失时忽略并 warn。
- §9 的 `<private/>` 免碳复制尚未支持（见 debug CORR-002）。