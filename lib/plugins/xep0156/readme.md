# XEP-0156 — 发现替代连接方式

通过 HTTPS 拉取 `.well-known/host-meta`（XRD）发现 WebSocket / BOSH 等替代连接端点。

- **依赖**：无
- **实例访问**：`connection.XEP0156`

## 可配置项

无可配置项。

## 注册后行为

`init()` 在以下任一条件成立时直接跳过：已有 `connection.url`、无 transport、未指定协议、协议为 `xmpp`。否则查询替代连接方式并回填 `connection`：

1. 协议 `ws` → 取 `websocket`；协议 `http` → 取 `xbosh`，取不到则抛错。
2. 按 `connection.tls` 在 `ws`/`wss`、`http`/`https` 间转换，写入 `connection.url`。
3. 设置 `connection.host`、`port`、`path`。

## 扩展字段

无。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0156.discoverAltXMPP(domain, timeout?)`（静态） | 拉取 `https://<domain>/.well-known/host-meta` → `{ websocket?, xbosh?, httppoll? }`（默认超时 5000ms） |

> `httppoll` 非规范 §2.1 定义的关系（规范只定义 `websocket` 与 `xbosh`），属兼容性扩展。

## 使用示例

```typescript
import XEP0156 from "@/plugins/xep0156";

// → Promise<{ websocket?, xbosh?, httppoll? }>（默认超时 5000ms）
const endpoints = await XEP0156.discoverAltXMPP("example.com");
console.log(endpoints.websocket);
```

## 注意事项

- 仅在未指定 URL 且协议不是 `xmpp` 时生效。
- 发现失败或未找到对应协议端点时只会 reject（unhandled promise rejection），不会阻断 `connect()`。
- 当前 `Connection.createSocket()` 尚不支持 `ws`/`http`，`init()` 因此不会被调用。
- 适用于需要通过 host-meta 自动发现 WebSocket/BOSH 地址的场景。