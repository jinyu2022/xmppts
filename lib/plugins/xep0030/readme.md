# XEP-0030 — 服务发现

服务发现（disco）：响应他人对自身的 disco#info / disco#items 查询，以及查询其他实体与服务器的身份、特性、子项。

- **依赖**：无
- **实例访问**：`connection.XEP0030`

## 可配置项

无可配置项。缓存参数为内置常量（TTL 30 分钟、容量 100 条、超限淘汰约 20%）。

## 注册后行为

`init()` 执行以下动作：

1. **注册自身特性** — 在 `features` 中添加 `disco#info` 与 `disco#items`。
2. **自动发现服务器** — `session:start` 时向自身服务器域名发起一次 disco#info，结果填充服务器特性/身份快照；失败仅 `log.warn`（并发调用复用同一次查询，失败后下次调用重试）。
3. **响应 disco 查询** — 监听 `iq`，对 `type='get'` 且含 `disco#info` / `disco#items` query 的请求，自动回复对应的 result IQ。

## 扩展字段

不扩展 stanza 接口。disco 信息以实例字段或方法返回值形式提供。

### 实例字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `identities` | `Identity[]` | 自身身份列表（供响应 query） |
| `features` | `Set<string>` | 自身特性集合（供响应 query） |
| `items` | `Item[]` | 自身 disco 子项（供响应 query） |

## 可监听事件

无专门事件。服务器发现结果通过 `getServerFeatures()` / `getServerIdentities()` 的 Promise 获取。

## 公开 API

| 方法 | 说明 |
|------|------|
| `getDiscoInfo(jid, node?, cache?)` | 查询实体身份/特性/扩展表单；失败抛 `XMPPError` |
| `getDiscoItems(jid, node?, cache?)` | 查询实体子项目列表；失败抛 `XMPPError` |
| `getServerFeatures()` | 服务器特性 `Promise<Set<string>>`（返回副本）；会话未就绪或查询失败时 reject（后者为原始错误） |
| `getServerIdentities()` | 服务器身份 `Promise<Identity[]>`（返回副本）；会话未就绪或查询失败时 reject（后者为原始错误） |
| `addFeature(ns)` | 添加自身特性 |
| `removeFeature(ns)` | 移除自身特性，返回是否成功 |
| `addIdentity(cat, type, name?, lang?)` | 添加自身身份 |
| `removeIdentity(cat, type, lang?)` | 移除自身身份 |
| `addItem(jid, node?, name?)` | 添加 disco 子项（如 PEP 节点） |
| `removeItem(jid, name)` | 移除 disco 子项 |

### getDiscoInfo 返回值

```typescript
{
  identities: Identity[];     // { category, type, name?, lang? }
  features: Set<string>;      // 支持的特性 namespace
  extensions?: DataForm;      // XEP-0128 扩展表单
}
```

## 使用示例

### 查询其他实体

```typescript
// → Promise<{ identities, features, extensions? }>（失败抛 XMPPError）
const info = await client.XEP0030!.getDiscoInfo("conference.example.com");
console.log(info.identities, [...info.features]);

// → Promise<Item[]>（失败抛 XMPPError）
const items = await client.XEP0030!.getDiscoItems("example.com");
```

### 读取服务器能力

```typescript
// → Promise<Set<string>>（返回副本）
const features = await client.XEP0030!.getServerFeatures();
// → Promise<Identity[]>（返回副本）
const identities = await client.XEP0030!.getServerIdentities();
```

### 声明自身能力

```typescript
client.XEP0030!.addFeature("urn:xmpp:example:1");       // → void
client.XEP0030!.addIdentity("client", "pc", "我的客户端"); // → void，重复抛 Error
client.XEP0030!.addItem("example.com", "urn:xmpp:example:1", "示例");
client.XEP0030!.removeFeature("urn:xmpp:example:1");     // → boolean（不存在返回 false）
client.XEP0030!.removeIdentity("client", "pc");          // → void（按 category+type+xml:lang 匹配，不存在静默返回）
client.XEP0030!.removeItem("example.com", "示例");        // → void（按 jid+name 匹配删除所有匹配项，不存在静默返回）
```

## 注意事项

- 缓存 TTL 30 分钟，`cache=false` 只跳过读取，查询结果仍写入缓存。
- `addFeature()` 依赖 Set 去重；`addIdentity()` 按 `category+type+xml:lang` 唯一，重复抛 `Error`；`addItem()` 重复抛 `Error`。
- `init()` 只预置 `disco#info`/`disco#items` 两个 feature，**不预置 identity**：自身 identity 为空时应答不含 `<identity/>`（§3.1 要求至少有身份），需自行 `addIdentity()`。
- 自动应答会把请求 `query` 的 `node` 原样回显（含空串）；`createInfoResult` 对 node 尚无语义处理。
- 其他插件通过 `connection.XEP0030` 访问实例。