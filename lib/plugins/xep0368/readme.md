# XEP-0368 — 直连 TLS 的 SRV 记录

注册后，`xmpp+tls` 连接优先使用 `_xmpps-client._tcp` SRV 公布的直连 TLS 端点，无记录时回退普通 TCP + STARTTLS。

- **依赖**：无
- **实例访问**：`connection.XEP0368`

## 可配置项

无可配置项。

## 注册后行为

构造函数在传输创建前覆盖 `xmpp` 传输工厂，此后 `xmpp` 连接默认优先直连 TLS：

1. 查询 `_xmpps-client._tcp.<domain>` SRV 记录，取优先级最高者。
2. 以该 `host`/`port` 建立直连 TLS 连接（SNI=账号域，ALPN=`xmpp-client`），无需 STARTTLS。
3. 无直连 TLS 记录时回退普通 TCP + STARTTLS。

以下情况不介入：`tls: false`（明确要求明文），或显式提供了完整的 `host` + `port`。

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

插件在连接时自动介入，一般无需手动调用：

```typescript
import XEP0368 from "@/plugins/xep0368";

// → Promise<端点列表>（按优先级排序）
const endpoints = await XEP0368.resolveDirectTLS("example.com");
```

## 注意事项

- 仅影响 `xmpp` 协议；`ws` 的 TLS 由 `wss://` 提供，不走 SRV。
- 不缓存 SRV 结果（意外断链可能与服务器 IP 相关）。
