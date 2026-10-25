# XEP-0156 — 发现替代连接方式

通过 HTTPS 拉取 `.well-known/host-meta`（XRD）解析 WebSocket 端点。纯工具类：不实现 `Plugin`，不登记在 `pluginLoaders`，由 [WSConnection](../../transport/websocket.ts) 在建立连接前调用。

- **入口**：`@/plugins/xep0156` 默认导出
- **触发条件**：`ws` 传输的端点不完整（`host` 或 `port` 缺失）时自动调用

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0156.resolveEndpoint(domain)`（静态） | 取 host-meta 的 `websocket` 端点 → `{ host, port?, path }`；只保留公布地址的显式端口，缺省端口由传输按最终 scheme 决定；未公布时抛错 |
| `XEP0156.discoverAltXMPP(domain, timeout?)`（静态） | 拉取 `https://<domain>/.well-known/host-meta` → `{ websocket?, xbosh?, httppoll? }`（默认超时 5000ms） |

> `httppoll` 非规范 §2.1 定义的关系（规范只定义 `websocket` 与 `xbosh`），属兼容性扩展。

## 使用示例

一般无需手动调用：`protocol: "ws"` 且未提供完整端点时，连接流程会自动发现。

```typescript
import { Client } from "xmppts";

const client = new Client("juliet@capulet.lit", "secret", { protocol: "ws" });
await client.connect(); // 未指定 host/port → host-meta 发现 WebSocket 端点
```

也可单独调用：

```typescript
import XEP0156 from "@/plugins/xep0156";

const endpoint = await XEP0156.resolveEndpoint("example.com");
```

## 注意事项

- `xbosh`/`httppoll` 只做发现：库内没有对应传输实现，浏览器请使用 `ws`。
- 用户显式提供完整 `host` + `port` 时不查询 host-meta。
- 缺省端口不在本工具内补齐：公布地址未写端口时返回 `port: undefined`，由 `WSConnection` 按最终使用的 scheme（`tls` 决定 wss/ws）补 443/80。
- 服务公布的地址为 `wss://` 时，`tls: false` 会按 `ws://` 连接，需要服务端同时接受明文（参见 [debug.md](debug.md) SEC-001）。