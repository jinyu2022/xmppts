# XEP-0203 — 延迟投递

解析消息中的 `<delay/>` 元素，用于离线消息等场景还原原始发送时间。

- **依赖**：XEP-0082（日期解析）
- **实例访问**：`connection.XEP0203`

## 可配置项

无可配置项。

## 注册后行为

`init()` 只注册 `urn:xmpp:delay` 命名空间解析器 `parseDelayEl`，把 `<delay>` 解析为 `message.delay`。

## 扩展字段

```typescript
interface Message {
  delay?: {
    stamp: Date;       // 原始发送时间
    from: string;      // 原始发送者 JID（§2 Table 1 定为 RECOMMENDED，运行时可能为 null）
    reason?: string;   // 延迟原因
  };
}
```

## 可监听事件

无专门事件。在 `message` 事件回调中检查 `message.delay` 字段。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0203.NS`（静态） | `"urn:xmpp:delay"` |
| `XEP0203.parseDelayEl(el)`（静态） | 解析 `<delay/>` → `{ delay }`；`stamp` 非法抛 `Error` |
| `XEP0203.createDelayEl(stamp, from, reason)`（静态） | 构造 `<delay/>` 元素（`reason` 按规范可选，当前签名为必填） |

## 使用示例

读取离线消息的原始发送时间：

```typescript
client.on("message", (message) => {
  if (message.delay) {
    console.log("原始发送时间", message.delay.stamp, "来自", message.delay.from);
  }
});
```

构造 `<delay/>`（→ `XMPPElement`）：

```typescript
import XEP0203 from "@/plugins/xep0203";

const delayEl = XEP0203.createDelayEl(new Date(), "example.com", "offline");
```

## 注意事项

- 通常出现在**离线消息**或服务器缓存的消息中。
- `delay.stamp` 是消息原始发送时间；`message` 本身的时间为当前投递时间。
- 时间戳由 XEP-0082 解析；非法 `stamp` 会转成带元素上下文的 `Error`（作为 stanza 处理器抛出，会中断该 stanza 的分发）。
- §2 允许 `<delay/>` 也出现在 presence（离线 presence 补发、MUC 历史），但当前只扩充了 `Message` 类型（见 debug CORR-005）。