# XEP-0198 — 流管理（Stream Management）

在流层追踪已发送/已处理的 stanza，支持断线后的会话恢复：恢复成功后按确认进度重发未确认的 stanza。

- **依赖**：无
- **实例访问**：`connection.XEP0198`

## 固定参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `XEP0198.interval`（静态只读） | `number` | `5` | 每发送 N 条 stanza 请求一次确认（`<r/>`） |

常量不可在运行期修改。

## 注册后行为

`init()` 通过传输层管线与就绪信号接入，全自动运行：

1. **抢占恢复** — 在 `stream:negotiated` 阶段，若本次为意外断线后的重连、此前已启用、持有恢复 ID、服务器允许恢复且未超出保留窗口（窗口取自服务器 `max`，未宣告或不是整数时按默认 5 分钟，超窗 `reset()` 并 warn），则把绑定请求替换为 `<resume/>`。
2. **处理恢复结果** — 在 `binding` 阶段收到 `<resumed/>` 则沿用原绑定、按 `h` 结算确认游标并重发剩余未确认项（直接写传输层，不重复计数）；收到 `<failed/>` 则先按可选的 `h` 结算，再回退为常规绑定。
3. **自动启用** — 会话就绪后（首次连接走 `session:start`，自动重连走 `reconnected`）若服务器宣告 `urn:xmpp:sm:3` 且当前流尚未启用，发送 `<enable resume='true'/>`。
4. **计数与确认** — 启用后通过发送/接收管线计数，每发送 `interval` 条 stanza 请求一次确认；收到 `<a/>` 按累积确认推进游标并裁剪未确认队列，收到 `<r/>` 自动回 `<a/>`；对端上报的 `h` 超过本端已发送数量时，按 §6 发 `undefined-condition` 流错误（含 `<handled-count-too-high/>`）并关闭流。
5. **关闭前确认** — `connection.disconnect()` 关闭流之前（连接层的 `session:beforeclose` 事件），若流管理已启用则同步发出最后一次 `<a/>` 报告已处理数量（§4），随后才写 `</stream:stream>`。

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
| `XEP0198.interval`（静态只读） | 请求确认的发送间隔，固定 `5` |
| `init()` | 注册管线拦截与就绪信号处理（由 Connection 调用） |
| `XEP0198.NS`（静态） | `"urn:xmpp:sm:3"` |

> 其余方法（`enable`、`requestAck`、`sendAnswerAck` 等）均为私有，仅供内部使用。

## 使用示例

全自动运行，无需配置，插件注册后由 `Connection` 创建并调用 `init()`：

```typescript
// 确认请求的发送间隔固定为 5 条 stanza，运行期不可修改
```

## 注意事项

- 依赖服务器在流特性中宣告 `urn:xmpp:sm:3`；未宣告时打印 warn，不影响正常通信。
- 仅当服务器回 `<enabled resume='true'/>`（`resume='1'` 等价）时才会在断线后尝试恢复；服务器未给 `id` 时会静默不尝试、不告警。
- 服务器未允许恢复时，断线即复位全部流状态：旧流的计数、`status`、`previd` 作废，重连后的新流会重新发送 `<enable/>` 并自 0 开始计数（不会向新流上报旧流的 `h`）。
- `<a/>`、`<resumed/>` 的 `h` 按累积确认处理：规范要求它是 `xs:unsignedInt`，服务端不会发送畸形值，因此实现按 `parseInt` 读取十进制前缀，不校验尾随字符；缺失或解析不出数值的确认忽略。重复与迟到的确认不会让游标后退，部分确认是正常情况；确认数量超过已发送数量时按 §6 发送流错误并关闭流（关闭前的 `session:beforeclose` 不再补发 `<a/>`）。
- 恢复失败会回退为常规绑定，连接不中断；旧流未确认的 stanza 不会在新流重发，只在日志中报告条数（规范 §4 建议重发或告知用户，本库暂无对外交付路径）。
- 重发包含队列中的 presence：§5 的「SHOULD NOT resend presence」只针对重播在线状态以恢复旧状态（服务器已保留），未确认队列属于同节「MUST re-send any stanzas that are still marked as unhandled」；跳过会让服务端计数与本地队列错位。
- 副作用：`<enabled/>` 携带的 `location` 会作为下次重连的端点，在断线时应用一次并清空（XEP-0198 §3）；`<enable/>` 被 `<failed/>` 时 reject `XMPPError`、等待期间断线时 reject `Error`，均只被 `.catch` 记日志，调用方无感知。
- 会话就绪时同步发出的 stanza 排在 `<enable/>` 之前，不计入流管理（XEP-0198 §4：计数自 `<enable/>` 起算），规范允许；恢复时服务器保留原 presence 状态，无需重发。