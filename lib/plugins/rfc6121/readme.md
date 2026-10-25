# RFC 6121 — 即时消息与存在（花名册）

名册（roster）管理：解析名册查询结果、响应服务器推送的名册变更，并提供订阅管理方法。

- **依赖**：无
- **实例访问**：`connection.RFC6121`

## 可配置项

无可配置项。构造函数只接收 `connection`，行为固定。

## 注册后行为

`init()` 执行以下动作：

1. **注册名册解析器** — 为命名空间 `jabber:iq:roster` 注册 `parseRosterEl`，把 IQ 的 `<query>` 子元素转换为 `iq.roster`（见「扩展字段」）。
2. **注册 `roster:update` 事件** — 匹配 `type='set'` 且含名册数据的 IQ，并校验来源为自身 bare JID（`from` 缺失视为自身），拒绝伪造推送（RFC 6121 §2.1.6）。
3. **自动应答** — 订阅 `roster:update`，向推送方回复 `type='result'` 的 IQ（RFC 6121 §2.1.6）。

## 扩展字段

```typescript
declare module "../../stanza" {
  interface Iq {
    roster?: Roster[];
  }
}

interface Roster {
  approved: boolean;   // 是否已被预批准订阅
  jid: string;         // 联系人 JID
  name?: string;       // 备注名
  ask?: "subscribe";   // 已发出订阅请求且尚未被批准
  subscription: "none" | "to" | "from" | "both" | "remove";
}
```

## 可监听事件

| 事件 | 触发时机 | 回调参数 |
|------|---------|----------|
| `roster:update` | 服务器推送名册变更（`type='set'` 且来源合法） | `Iq`（含 `roster`） |

> 事件触发时插件已自动回复 `type='result'`，监听方只需同步本地状态，无需再应答。

## 公开 API

| 方法 | 说明 |
|------|------|
| `getRoster()` | 获取完整名册 → `Promise<Roster[]>`；服务端报错抛 `XMPPError`。未实现 §2.6 roster versioning（不发/不存 `ver`）；服务端返回不含 `<query/>` 的空 result 时直接取 `[0]` 并访问属性，会抛 `TypeError` |
| `setRoster(jid, name?, group?)` | 新增/更新名册项；省略 `name` 会清空备注名，省略 `group` 会移出全部分组（RFC 6121 §2.4 原子更新） |
| `removeRoster(jid)` | 删除名册项（`subscription="remove"`） |
| `requestSubscription(jid)` | 请求订阅对方存在状态（`<presence type="subscribe">`） |
| `removeSubscription(jid)` | 撤销被订阅 / 拒绝订阅请求 / 取消预批准（`unsubscribed`） |
| `cancelSubscribe(jid)` | 取消对对方的订阅（`unsubscribe`） |
| `approveSubscription(jid)` | 批准对方的订阅请求（`subscribed`）；也用于预批准，§3.4.1 要求服务器宣告 `urn:xmpp:features:pre-approval`，当前未检查 |
| `RFC6121.parseRosterEl(el)`（静态） | 解析 `jabber:iq:roster` 的 `<query>` 元素 → `{ roster: Roster[] }`；命名空间不符时抛普通 `Error` |

## 使用示例

### 获取与维护名册

```typescript
// → Promise<Roster[]>（失败抛 XMPPError）
const roster = await client.RFC6121!.getRoster();

// 新增/更新：省略 name 会清空备注名，省略 group 会移出全部分组
// → Promise<void>（失败抛 XMPPError）
await client.RFC6121!.setRoster("friend@example.com", "小明", "好友");

// 删除名册项
// → Promise<void>（失败抛 XMPPError）
await client.RFC6121!.removeRoster("friend@example.com");
```

### 订阅管理

```typescript
// 以下方法均只发 presence，返回 void
client.RFC6121!.requestSubscription("friend@example.com");
client.RFC6121!.approveSubscription("friend@example.com");
client.RFC6121!.cancelSubscribe("friend@example.com");
client.RFC6121!.removeSubscription("friend@example.com");
```

### 监听名册推送

```typescript
import type { Iq } from "@/stanza";

client.on("roster:update", (iq: Iq) => {
  for (const item of iq.roster ?? []) {
    // subscription === "remove" 表示删除，否则为新增/更新
    console.log(item.jid, item.subscription);
  }
});
```

## 注意事项

- 名册的 `subscription` 由服务器根据双向订阅情况计算，客户端不应自行推断。
- `setRoster()` 是原子更新：未提供的字段会被服务器置空（`name`、`group` 同理）。
- 订阅管理方法只发送 presence，订阅状态的变化通过服务器下发的事件体现。
- 推送来源校验依据 RFC 6121 §2.1.6：`from` 必须是自身 bare JID 或缺失；当前只比较 `from.bare`，同账号其他 resource 也会通过（见 [debug.md](debug.md) SEC-001）。