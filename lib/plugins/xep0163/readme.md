# XEP-0163 — 个人事件协议（PEP）

在用户自己的 bare JID 上发布/订阅个人事件，是头像、昵称、书签等功能的底层传输。

- **依赖**：XEP-0030（服务发现）；底层复用 XEP-0060 PubSub（仅类复用，非可注册插件）
- **实例访问**：`connection.XEP0163`

## 可配置项

无可配置项。构造函数只接收 `connection`，行为固定。

## 注册后行为

`init()` 只做一件事：为命名空间 `http://jabber.org/protocol/pubsub#event` 注册 `Pubsub.parseEventEl`，把 Message 中的 `<event>` 子元素解析为结构化的 `message.event`（见「扩展字段」）。

> 服务器能力检查（是否为 PEP 服务）对应的代码已被注释，插件不会因服务器不支持而自动卸载；且原探测查的是域名身份，而 §6.1 要求探测自身 bare JID。

## 扩展字段

以下类型实际定义在 [xep0060/pubsub.ts](../xep0060/pubsub.ts)（本插件只注册解析器）：

```typescript
declare module "../../stanza" {
  interface Message {
    event?: PubsubEvent;
  }
}

// <event/> 只含一个子元素（§17.3），故为可判别联合，type 即子元素名
type PubsubEvent = { node?: string } & (
  | { type: "items"; items?: PubsubEventItem[]; item?: PubsubEventItem; retracts?: string[] }
  | { type: "collection"; associate?: string; disassociate?: string }
  | { type: "configuration"; form?: XMPPElement }
  | { type: "delete"; redirect?: string }
  | { type: "purge" }
  | { type: "subscription"; jid?: string; subid?: string;
      subscription?: PubsubSubscriptionState; expiry?: string }
  | { type: "unknown" }   // 未列举的子元素，只保留 node
);

interface PubsubEventItem {
  id?: string;
  publisher?: string;
  [key: string]: unknown;   // 随节点不同，携带不同的子元素
}
```

各分支的字段含义与 `<items/>` 首项限制见 [xep0060/readme.md](../xep0060/readme.md#parseEventEl-返回值)。

## 可监听事件

无专门事件。PEP 更新以 `message.event` 字段的形式随普通 `message` 事件到达。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0163.createRetrieveItemsIq(to, node, max?, itemIds?)`（静态） | 构造检索节点项目的 IQ（get）；`itemIds` 为要检索的 ItemID 数组（§6.5.6 要求支持一次指定多项）；省略表示取最新项目 |
| `XEP0163.createPublishIq(publish, publishOptions?)`（静态） | 构造发布项目的 IQ（set） |
| `XEP0163.createRetractIq(node, id, notify?)`（静态） | 构造撤回项目的 IQ（set） |
| `Pubsub.parseEventEl(el)`（静态，经 XEP-0060） | 解析 `<event>` 元素 → `{ event: PubsubEvent }`；命名空间不符抛 `Error`（解析器由本插件注册） |

## 使用示例

静态方法经类本身调用（PEP 地址即自身 bare JID）：

```typescript
import XEP0163 from "@/plugins/xep0163";

// 构造检索/发布/撤回 IQ → Iq，自行发送
const iq = XEP0163.createRetrieveItemsIq(client.jid.bare, "urn:xmpp:example:1");
client.send(XEP0163.createPublishIq(publishEl));
client.send(XEP0163.createRetractIq("urn:xmpp:example:1", "item-id"));
```

PEP 更新随普通 `message` 事件到达：

```typescript
client.on("message", (message) => {
  if (message.event) console.log(message.event.node, message.event.items);
});
```

## 注意事项

- 依赖 **XEP-0060**（PubSub，`XEP0060` 插件只注册 `pubsub#errors` 解析器，其余能力是 `Pubsub` 的静态方法）与 **XEP-0030**（服务发现）。
- PEP 服务地址即用户的 bare JID。
- 接收好友的 PEP 更新需关注 `+notify` 特性。
- 本插件是 XEP-0084（头像）、XEP-0172（昵称）、XEP-0402（书签）的底层传输。