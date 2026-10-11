# XEP-0297 — 节转发（Stanza Forwarding）

在消息中封装一个已转发的 stanza（message / presence / iq）。

- **依赖**：XEP-0030（服务发现）、XEP-0203（延迟投递）
- **实例访问**：`connection.XEP0297`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 forwarded 解析器** — 解析 `urn:xmpp:forward:0` 命名空间的 `<forwarded>` 为 `message.forwarded`。
2. **注册 `forward` 事件** — 收到含 `<forwarded>` 的消息时触发。

`init()` 未调用 `XEP0030.addFeature(XEP0297.NS)`（§4 SHOULD），也未使用声明的 XEP-0203 依赖（`delay` 原样保留为元素）；carbons（XEP-0280）会在同一 message 上另行暴露 `carbon.forwarded`，二者指向同一元素、形状不同——消费时择一即可。

## 扩展字段

```typescript
interface Message {
  readonly forwarded?: Forwarded;
}

type Forwarded = { delay?: XMPPElement | null } & (
  | { message?: XMPPElement | null }
  | { presence?: XMPPElement | null }
  | { iq?: XMPPElement | null }
);
```

各分支的键均**可选**（`Pick` 保留了 `Base` 的可选性），类型上即"最多一个键"，实际解析保证恰有一个。

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `forward` | 收到含 `<forwarded>` 的消息 | `Message & { forwarded: Forwarded }` |

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0297.NS`（静态） | `"urn:xmpp:forward:0"` |
| `XEP0297.parseForwardedEl(el)`（静态） | 解析 `<forwarded>` → `{ forwarded }`；缺 `<forwarded>` 或 payload 不唯一时抛普通 `Error` |

## 使用示例

```typescript
client.on("forward", (message) => {
  const fwd = message.forwarded!;
  // message / presence / iq 三者恰有其一
  const inner = fwd.message ?? fwd.presence ?? fwd.iq;
  console.log("转发的节", inner);
});
```

## 注意事项

- 主要被 **XEP-0280（碳副本）** 使用。
- 被转发节中可能含 `delay` 元素；此处 `delay` 仍是原始元素，未走 XEP-0203 解析。