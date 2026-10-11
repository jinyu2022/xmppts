# XEP-0368 — 直连 TLS 的 SRV 记录

连接前介入，为启用 TLS 的连接解析 `_xmpps-client._tcp` SRV 端点并注入加密 socket（直接 TLS，无需 STARTTLS）。

- **依赖**：无
- **实例访问**：`connection.XEP0368`

## 可配置项

无可配置项。

## 注册后行为

`init()` 在传输管线注册一个 `beforeConnect` 处理器。当**尚未指定地址且本次连接启用 TLS** 时：

1. 查询 `_xmpps-client._tcp.<domain>` SRV 记录，取优先级最高者。
2. 写入 `ctx.url = xmpps://host:port`。
3. 用 `node:tls` 直连该端点（SNI=账号域，ALPN=`xmpp-client`），通过 `ctx.setSocket()` 注入加密 socket。
4. 握手完成（`secureConnect`）后把状态置为 `TLS_ESTABLISHED`，管线据此分派进 SASL。

已有地址或非 TLS 连接时直接放行，不做干预。

## 扩展字段

无。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0368.resolveDirectTLS(domain)`（静态） | 查询 `_xmpps-client._tcp` SRV 记录 → 按优先级排序的端点列表 |
| `XEP0368.SRV_SERVICE`（静态） | `"_xmpps-client._tcp"` |
| `XEP0368.FALLBACK_SERVICE`（静态） | `"_xmpp-client._tcp"` |

## 使用示例

插件在 `beforeConnect` 自动介入，一般无需手动调用：

```typescript
import XEP0368 from "@/plugins/xep0368";

// → Promise<端点列表>（按优先级排序）
const endpoints = await XEP0368.resolveDirectTLS("example.com");
```

## 注意事项

- 仅对直连 TLS 生效；无直连 TLS 记录时回落到普通 TCP/TLS 流程。
- 不缓存 SRV 结果（意外断链可能与服务器 IP 相关）。
