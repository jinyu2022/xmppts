# XEP-0198 — 流管理（Stream Management）

在流层追踪已发送/已处理的 stanza，支持断线后的会话恢复；配合重传后才不丢消息（`<resumed/>` 后的重传尚未实现，见下）。

- **依赖**：无
- **实例访问**：`connection.XEP0198`

## 可配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `XEP0198.interval`（静态） | `number` | `5` | 每发送 N 条 stanza 请求一次确认（`<r/>`） |

可随时修改（发送拦截器在运行时读取）。

## 注册后行为

`init()` 通过传输层管线与就绪信号接入，全自动运行：

1. **抢占恢复** — 在 `stream:negotiated` 阶段，若本次为意外断线后的重连、此前已启用、持有恢复 ID、服务器允许恢复且未超出保留窗口（窗口取自服务器 `max`，未宣告时默认 5 分钟，超窗 `reset()` 并 warn），则把绑定请求替换为 `<resume/>`。
2. **处理恢复结果** — 在 `binding` 阶段收到 `<resumed/>` 则沿用原绑定并置为已绑定；收到 `<failed/>` 则回退为常规绑定。
3. **自动启用** — 会话就绪后（首次连接走 `session:start`，自动重连走 `reconnected`）若服务器宣告 `urn:xmpp:sm:3`，发送 `<enable resume='true'/>`。
4. **计数与确认** — 启用后通过发送/接收管线计数，达到 `interval` 整数倍时请求确认；收到 `<r/>` 自动回 `<a/>`。

### 状态机

| 状态 | 值 | 说明 |
|------|----|------|
| `DISABLE` | 0 | 未启用 |
| `ENABLE_SENT` | 1 | 已发送启用请求，等待确认 |
| `ENABLE` | 2 | 已启用流管理 |

## 扩展字段

不扩展 stanza。使用独立的 `<r/>` / `<a/>` / `<enable/>` / `<resume/>` 元素。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0198.interval`（静态） | 请求确认的发送间隔，默认 `5` |
| `init()` | 注册管线拦截与就绪信号处理（由 Connection 调用） |
| `XEP0198.NS`（静态） | `"urn:xmpp:sm:3"` |

> 其余方法（`enable`、`requestAck`、`sendAnswerAck` 等）均为私有，仅供内部使用。

## 使用示例

全自动运行，通常只需按需调整确认间隔：

```typescript
import XEP0198 from "@/plugins/xep0198";

// 每 10 条 stanza 请求一次确认（默认 5）
XEP0198.interval = 10;
```

## 注意事项

- 依赖服务器在流特性中宣告 `urn:xmpp:sm:3`；未宣告时打印 warn，不影响正常通信。
- 仅当服务器回 `<enabled resume='true'/>`（`resume='1'` 等价）时才会在断线后尝试恢复；服务器未给 `id` 时会静默不尝试、不告警（见 debug M8）。
- 服务器返回的 `h` 与本地 `outbound` 不一致时：`<resumed/>` 路径 warn 并采用服务器值（未重传，见 debug S1）；`<a/>` 路径只 warn（见 debug M1）。
- 恢复失败会回退为常规绑定，连接不中断。
- 未实现：§5 恢复后按序重传 `h+1…outbound`（debug S1，消息可能丢）；§6 对端 `h` 过高时发 `handled-count-too-high` 流错误；§4 关闭流前主动发 `<a/>`、收到 `<a/>` 后记录最新 `h`、`h` 达 2^32-1 回绕（debug M10）；`<resumed/>` 的 `previd` 校验（debug M3）。
- 副作用：`<enabled/>` 携带的 `location` 会作为下次重连的端点，在断线时应用一次并清空（XEP-0198 §3）；`<enable/>` 被 `<failed/>` 时 reject 的 `XMPPError` 只被 `.catch` 记日志，调用方无感知。
- 会话就绪时同步发出的 stanza 排在 `<enable/>` 之前，不计入流管理（XEP-0198 §4：计数自 `<enable/>` 起算），规范允许；恢复时服务器保留原 presence 状态，无需重发。