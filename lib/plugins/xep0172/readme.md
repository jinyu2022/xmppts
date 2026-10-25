# XEP-0172 — 用户昵称

通过 PEP 发布/获取用户昵称。

- **依赖**：XEP-0030（服务发现）、XEP-0163（PEP；`message.event` 由 XEP0163 填充，源码 `dependencies` 暂只声明 XEP0030，见 debug CORR-002）
- **实例访问**：`connection.XEP0172`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **注册 nick 解析器** — 解析命名空间 `http://jabber.org/protocol/nick` 的元素为 `nick` 字段。
2. **注册 `pep:nickname` 事件** — 匹配 `message.event.node === nick`。
3. **监听 `session:start`** — 当前为空实现。

## 扩展字段

```typescript
interface Message { nick?: string; }
interface Presence { nick?: string; }
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `pep:nickname` | 收到昵称更新的 PEP 通知 | `Message & { nick: string }` |

## 公开 API

| 方法 | 说明 |
|------|------|
| `retrieveNick(jid)` | 查询指定用户昵称 → `Promise<string>`；失败抛 `XMPPError` |
| `getSelfNick()` | 获取自己的昵称，结果缓存，失败仅 warn 并返回 `undefined` |
| `XEP0172.NS`（静态） | `"http://jabber.org/protocol/nick"` |
| `XEP0172.parseNickEl(el)`（静态） | 解析 `<nick/>` → `{ nick }` |
| `XEP0172.createNickPublishIq(nick)`（静态） | 构造发布昵称 IQ（PEP） |
| `XEP0172.createRetrieveNickIq(jid)`（静态） | 构造检索昵称 IQ |
| `XEP0172.createNickSubscribe(to, nick)`（静态） | 构造带 nick 的 `type="subscribe"` presence；目标转为 bare JID，无效 JID 抛 `Error` |
| `XEP0172.createNickMessage(to, message, nick)`（静态） | 构造带 nick 的消息 |

## 使用示例

```typescript
import XEP0172 from "@/plugins/xep0172";

// 查询他人昵称 → Promise<string>（失败抛 XMPPError）
const nick = await client.XEP0172!.retrieveNick("friend@example.com");

// 获取自己的昵称 → Promise<string | undefined>（缓存，失败返回 undefined）
const selfNick = await client.XEP0172!.getSelfNick();

// 发布昵称：构造 IQ 后自行发送
client.send(XEP0172.createNickPublishIq("小明"));
```

### 监听昵称更新

```typescript
client.on("pep:nickname", (message) => {
  console.log(message.nick);
});
```

## 注意事项

- `getSelfNick()` 结果会被缓存，只请求一次（失败结果同样缓存）；失败时返回 `undefined` 不抛异常（容错设计）。
- XEP-0402（书签）使用 `getSelfNick()` 作为房间昵称回退。
- 发布昵称需自行调用静态 `createNickPublishIq()` 构造 IQ 后发送（无实例级 `setNick()`）。
- 不支持回退到 XEP-0060（PEP 不可用时不做 pubsub 直查）。