# XEP-0199 — XMPP Ping / Keep-Alive

XMPP 层心跳：响应他人的 ping，并向服务器发送周期性 ping 以维持连接。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0199`

## 可配置项

通过 `registerPlugin()` 的第二个参数传入（`XEP0199Options`），省略的字段取默认值：

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `keepalive` | `boolean` | `true` | 是否启用周期性 Keep-Alive ping |
| `interval` | `number` | `300_000`（5 分钟） | Keep-Alive 间隔（ms） |
| `timeout` | `number` | `30_000`（30 秒） | 单次 ping 的超时（ms） |

```typescript
connection.registerPlugin("XEP0199", {
  // keepalive: false,  // 禁用 Keep-Alive（默认 true）
  // interval: 60_000,  // 心跳间隔 ms（默认 300_000）
  // timeout: 10_000,   // ping 超时 ms（默认 30_000）
});
```

> **约束**：`interval` 必须 ≥ `timeout`。违反时打印 warn，并改用默认的 `interval` / `timeout`（仅 `keepalive` 仍按传入值覆盖）。

## 注册后行为

`init()` 执行以下动作：

1. **响应 ping** — 监听 `iq` 事件，对 `type='get'` 且含 `urn:xmpp:ping` 的 IQ 自动回复 `type='result'`。
2. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:ping`。
3. **启动 Keep-Alive** — 会话开始后通过 `getServerFeatures()` 查询服务器特性，仅当服务器支持 ping 且 `keepalive` 为真时调用 `keepAlivePing()`；获取失败时打印 warn。

## 扩展字段

不扩展 stanza 接口。

## 可监听事件

无专门事件。

## 公开 API

| 方法 | 说明 |
|------|------|
| `ping(to, timeout?)` | 向指定实体发送 ping → `Promise<number>`（往返耗时 ms）；超时抛 `TimeoutError`，错误应答抛 `XMPPError` |
| `keepAlivePing()` | 立即启动/重排 Keep-Alive 定时器（已存在则先清除）；通常无需手动调用 |
| `XEP0199.NS`（静态） | `"urn:xmpp:ping"` |
| `XEP0199.createSendPingIq(to)`（静态） | 构造 ping 请求 IQ（get） |
| `XEP0199.createPingResultIq(from, to, id)`（静态） | 构造 ping 应答 IQ（result） |

## 使用示例

Keep-Alive 自动运行，通常只需按需手动 ping：

```typescript
// → Promise<number>（往返耗时 ms）；超时抛 TimeoutError，错误应答抛 XMPPError
const rtt = await client.XEP0199!.ping("example.com");
console.log(`RTT ${rtt}ms`);
```

## 注意事项

- Keep-Alive 仅在服务器支持 ping 时启动；服务器不支持时打印 info 日志，插件不会被卸载。
- 定时器回调在连接为 `DISCONNECTED` 时跳过本次 ping。
- 定时器调用 `unref()`，不会阻止 Node.js 进程退出。