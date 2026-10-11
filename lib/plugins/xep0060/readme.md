# XEP-0060 — 发布-订阅（PubSub）

PubSub 工具：构造实体（§5）、订阅者（§6）、发布者（§7）、所有者（§8）四类用例的 IQ，解析事件通知、查询结果与附加错误条件。供 XEP-0163（PEP）等插件复用。

- **依赖**：无（数据表单由调用方用 XEP-0004 构造后传入，本模块不引入 XEP-0004）
- **实例访问**：`connection.XEP0060`，插件实例只注册 `pubsub#errors` 的解析器，其余能力都在 `Pubsub` 静态方法上
- @see https://xmpp.org/extensions/xep-0060.html（@version 1.30.0）

## 可配置项

无可配置项。

## 注册后行为

只注册一个 stanza 转换器：`pubsub#errors`（§11、§17.2）→ `Pubsub.parseErrorChildEl`。
不发送任何节，不注册事件插件。不注册时，`<error/>` 里的附加条件元素仍会原样保留在
`stanza.error.<元素名>` 上（由 `StanzaBase` 保留未知子元素）。

## 扩展字段

`StanzaError.pubsub`：错误响应里的 pubsub 专有附加条件（见「parseErrorChildEl 返回值」）。
`message.event` 由 XEP-0163 挂载，不在本模块。

## 命名空间

| 常量 | 值 | 用途 |
|------|-----|------|
| `Pubsub.NS.BASE` | `http://jabber.org/protocol/pubsub` | 常规请求/结果、`<subscribe/>`、`<items/>`、`<create/>` |
| `Pubsub.NS.EVENT` | `http://jabber.org/protocol/pubsub#event` | `<event/>` 通知 |
| `Pubsub.NS.OWNER` | `http://jabber.org/protocol/pubsub#owner` | 节点配置、删除、清空、订阅/权限管理 |
| `Pubsub.NS.ERRORS` | `http://jabber.org/protocol/pubsub#errors` | 附加错误条件 |
| `Pubsub.FORM_TYPE.PUBLISH_OPTIONS` | `http://jabber.org/protocol/pubsub#publish-options` | §7.1.5 发布选项表单的 `FORM_TYPE` |
| `Pubsub.FORM_TYPE.NODE_CONFIG` | `http://jabber.org/protocol/pubsub#node_config` | §8.2 节点配置表单的 `FORM_TYPE` |

`FORM_TYPE` 是数据表单类型标识（XEP-0068），取值形如命名空间但与元素命名空间不同类，故单列一项。

## 类型与常量

```typescript
// 订阅状态（§4.2 表3）
type PubsubSubscriptionState = "none" | "pending" | "subscribed" | "unconfigured";
// 成员与发布权限（§4.1 表1）
type PubsubAffiliation = "none" | "member" | "outcast" | "owner" | "publisher" | "publish-only";
// 节点类型（§4.4 表5）
type PubsubNodeType = "leaf" | "collection";
// pubsub#errors 附加条件（§17.2 模式）
type PubsubErrorCondition = "configuration-required" | "invalid-payload" | "item-required"
  | "nodeid-required" | "not-subscribed" | "payload-too-big" | "subid-required"
  | "unsupported" | ...;

const PUBSUB_SUBSCRIPTION_STATES: readonly PubsubSubscriptionState[];  // 运行时取值表
const PUBSUB_AFFILIATIONS: readonly PubsubAffiliation[];               // 运行时取值表
const PUBSUB_NODE_TYPES: readonly PubsubNodeType[];                    // 运行时取值表
const PUBSUB_ERROR_CONDITIONS: readonly PubsubErrorCondition[];        // 运行时取值表

interface PubsubSubscription     { node?: string; jid?: string; subscription?: PubsubSubscriptionState; subid?: string }
interface PubsubAffiliationItem  { node?: string; jid?: string; affiliation?: PubsubAffiliation }
interface PubsubItems            { node?: string; items: PubsubEventItem[]; retracts: string[] }
interface PubsubErrorConditionInfo { condition: PubsubErrorCondition; feature?: string }
interface PubsubNodeConfig       // §16.4.4 注册的节点配置项，见下
type PubsubEvent                 // <event/> 可判别联合，见「parseEventEl 返回值」
```

`PubsubNodeConfig`：`#node_config` 与 `#publish-options` 共用的配置项，属性名省略注册用法的 `pubsub#` 前缀，值域受注册类型约束（如 `accessModel` 只接受 `"authorize" | "open" | "presence" | "roster" | "whitelist"`，`maxItems` 为 `number | "max"`），未给出的属性不写出。

`PubsubEventItem`：`{ id?, publisher?, [key: string]: unknown }`，节点不同载荷元素不同，按载荷根元素的 `localName` 挂载（如 `item.entry`、`item.conference`）。

`<items/>` 中的 item 与其载荷只对**首项**做完整转换：`item`（即 `items[0]`，同一对象）的载荷会被换成解析后的对象，而 `items[1..]` 仍是原 XML 元素——转换层不处理数组。逐项处理 `event.items` 时须自行判断载荷类型。

## 公开 API

### 实体用例（§5）

| 方法 | 说明 |
|------|------|
| `Pubsub.createRetrieveSubscriptionsIq(to, node?)`（静态） | 检索订阅列表（get，BASE）；省略 `node` 表示检索全部节点 |
| `Pubsub.createRetrieveAffiliationsIq(to, node?)`（静态） | 检索权限列表（get，BASE）；省略 `node` 表示检索全部节点 |

### 订阅者用例（§6）

| 方法 | 说明 |
|------|------|
| `Pubsub.createSubscribeIq(to, node, jid, form?)`（静态） | 订阅节点（set）；`form` 用于 §6.3.7 同时提交订阅选项 |
| `Pubsub.createUnsubscribeIq(to, node, jid, subid?)`（静态） | 退订（set） |
| `Pubsub.createRetrieveSubscriptionOptionsIq(to, node, jid, subid?)`（静态） | 检索订阅选项（get） |
| `Pubsub.createSubmitSubscriptionOptionsIq(to, node, jid, form, subid?)`（静态） | 提交订阅选项（set） |
| `Pubsub.createDefaultSubscriptionOptionsIq(to, node?)`（静态） | 检索默认订阅选项（get）；省略 `node` 表示服务级默认值 |
| `Pubsub.createRetrieveItemsIq(to, node, max?, itemIds?)`（静态） | 检索节点项目（get）；`itemIds` 为要检索的 ItemID 数组（§6.5.6 要求支持一次指定多项，Example 78） |

### 发布者用例（§7）

| 方法 | 说明 |
|------|------|
| `Pubsub.createPublishIq(publish, publishOptions?, to?)`（静态） | 由现成 `<publish/>` 构造发布请求（set）；node 属性与 0/1 个 `<item/>` 由调用方按 §7.1.1 给出 |
| `Pubsub.createPublishOptionsEl(config)`（静态） | 由 `PubsubNodeConfig` 构造 `<publish-options/>`（§7.1.5）；字段即发布前提条件，服务端与同名节点配置比对 |
| `Pubsub.createRetractIq(node, id, notify?, to?)`（静态） | 撤回项目（set） |

### 所有者用例（§8）

| 方法 | 说明 |
|------|------|
| `Pubsub.createNodeIq(to, node?, form?)`（静态） | 创建节点（set，BASE）；省略 `node` 为即时节点，`form` 用于创建时配置 |
| `Pubsub.createRetrieveNodeConfigIq(to, node)`（静态） | 检索节点配置表单（get，OWNER） |
| `Pubsub.createNodeConfigForm(config)`（静态） | 由 `PubsubNodeConfig` 构造 `#node_config` 提交表单（§8.2），供 `createNodeIq`、`createConfigureNodeIq` 使用 |
| `Pubsub.createConfigureNodeIq(to, node, form)`（静态） | 提交节点配置（set，OWNER）；`type='cancel'` 的 `<x/>` 表示放弃配置 |
| `Pubsub.createDefaultNodeConfigIq(to, nodeType?)`（静态） | 检索默认节点配置（get，OWNER） |
| `Pubsub.createDeleteNodeIq(to, node, redirectUri?)`（静态） | 删除节点（set，OWNER），可带重定向 URI |
| `Pubsub.createPurgeNodeIq(to, node)`（静态） | 清空节点全部项目（set，OWNER） |
| `Pubsub.createRetrieveNodeSubscriptionsIq(to, node)`（静态） | 检索节点订阅列表（get，OWNER） |
| `Pubsub.createModifyNodeSubscriptionsIq(to, node, subscriptions)`（静态） | 修改订阅状态（set，OWNER）；只提交增量，`subscription='none'` 即删除订阅者；每条条目必须带 `jid` |
| `Pubsub.createRetrieveNodeAffiliationsIq(to, node)`（静态） | 检索节点权限列表（get，OWNER） |
| `Pubsub.createModifyNodeAffiliationsIq(to, node, affiliations)`（静态） | 修改权限（set，OWNER）；只提交增量，`affiliation='none'` 即移除实体；每条条目必须带 `jid` |

### 解析

| 方法 | 说明 |
|------|------|
| `Pubsub.parseEventEl(eventEl)`（静态） | 解析 `<event>` → `{ event: PubsubEvent }`；命名空间不符抛 `Error` |
| `Pubsub.parseItems(itemsEl)`（静态） | 解析 `<items>` → `PubsubItems`；检索结果（`NS.BASE`）与事件通知（`NS.EVENT`）共用 |
| `Pubsub.parseSubscriptions(el)`（静态） | 解析 `<subscriptions>`（`NS.BASE` / `NS.OWNER`）或单独返回的 `<subscription>` → `PubsubSubscription[]` |
| `Pubsub.parseAffiliations(el)`（静态） | 解析 `<affiliations>`（`NS.BASE` / `NS.OWNER`） → `PubsubAffiliationItem[]` |
| `Pubsub.parseErrorChildEl(el)`（静态） | 解析单个 `pubsub#errors` 附加条件元素 → `{ pubsub: PubsubErrorConditionInfo }`；命名空间不符抛 `Error` |

解析方法只接受目标元素本身，不做子元素查找：元素名或命名空间不符时抛 `Error`。

### parseErrorChildEl 返回值

```typescript
// <error type='cancel'>
//   <feature-not-implemented xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
//   <unsupported xmlns='http://jabber.org/protocol/pubsub#errors' feature='instant-node'/>
// </error>
iq.error;
// {
//   type: "cancel",
//   condition: "feature-not-implemented",   // stanza 级条件，StanzaBase 解析
//   pubsub: { condition: "unsupported", feature: "instant-node" },
// }
```

条件名与 `feature` 各出现一次：`pubsub.condition` 即 `pubsub#errors` 子元素的元素名，`pubsub.feature`
只对 `<unsupported/>` 有意义（§11.1）。§17.2 之外的扩展条件同样按元素名照收，不猜测其语义。
一条 `<error/>` 里出现多个 pubsub 附加条件时只保留最后一个（规范只允许一个，原 XML 见 `stanza.xml`）。
该字段只在注册 XEP0060 插件后出现。

### parseEventEl 返回值

`<event/>` 只含一个子元素（§17.3 是 `choice`），返回值是与子元素一一对应的可判别联合，`type` 即子元素名，`switch` 可穷尽；子元素内的协议数据已展开为普通字段，不再保留元素本身：

```typescript
type PubsubEvent = { node?: string } & (
  | { type: "items" }         // §7.1.2 发布 / §7.2.2.1 撤回
  | { type: "collection" }    // XEP-0248 集合关联/解除关联
  | { type: "configuration" } // §8.2.5.3 配置变更
  | { type: "delete" }        // §8.4.2 节点删除
  | { type: "purge" }         // §8.5.2 节点清空
  | { type: "subscription" }  // §12.14 订阅状态变更
  | { type: "unknown" }       // 未列举的子元素，只保留 node
);
```

| `type` | 附加字段 | 取值来源 |
|--------|---------|---------|
| `items` | `items?: PubsubEventItem[]`、`item?: PubsubEventItem`（首个）、`retracts?: string[]` | §7.1.2 / §7.2.2.1 |
| `collection` | `associate?`、`disassociate?` | `<associate/>`/`<disassociate/>` 的 `node` 属性 |
| `configuration` | `form?: XMPPElement` | `<configuration/>` 内的 `jabber:x:data` 表单 |
| `delete` | `redirect?` | `<redirect/>` 的 `uri` 属性 |
| `purge` | 无（数据全在 `node` 上） | §8.5.2 |
| `subscription` | `jid?`、`subid?`、`subscription?`（状态字符串，非元素）、`expiry?` | `<subscription/>` 自身的属性；`expiry` 为 §12.5 租约到期时间 |
| `unknown` | 无 | 未列举的子元素（规范扩展） |

各分支都声明了全部载荷字段（未用到的为 `never`），所以 `event.item`、`event.redirect` 这类读取可以直接写；未列举的子元素归入 `unknown`，原 XML 可从 `message.xml` 取。

## 使用示例

```typescript
import { Pubsub } from "@/plugins/xep0060/pubsub";

// 需要把 pubsub#errors 附加条件解析到 stanza.error.pubsub 时注册插件（只注册这一条解析器）
connection.registerPlugin("XEP0060");

// 订阅者：订阅节点并提交选项（§6.1.1 / §6.3.7，form 由 XEP-0004 构造）
const iq = Pubsub.createSubscribeIq("pubsub.example.com", "urn:xmpp:example:1", "me@example.com", form);

// 发布者：把自建的 <publish/>（node 属性 + 0/1 个 <item/>，§7.1.1）包成发布请求
const pubIq = Pubsub.createPublishIq(publishEl);

// 所有者：创建并配置节点（§8.1.3）
const nodeIq = Pubsub.createNodeIq("pubsub.example.com", "urn:xmpp:example:1", configForm);

// 发布前提条件（§7.1.5）：字段名自动映射为 pubsub#...，不满足时服务端返回 precondition-not-met
const publishOptions = Pubsub.createPublishOptionsEl({ accessModel: "whitelist", persistItems: true });

// 节点配置（§8.2）：同一个类型化配置，作为 owner <configure/> 的表单提交
const configureIq = Pubsub.createConfigureNodeIq(
  "me@example.com",
  "urn:xmpp:example:1",
  Pubsub.createNodeConfigForm({ accessModel: "whitelist", maxItems: "max" }),
);

// 解析事件通知
const { event } = Pubsub.parseEventEl(eventEl);

// 解析查询结果：先按命名空间取出协议元素，再交给对应解析方法
const subscriptions = Pubsub.parseSubscriptions(resultIq.querySelector(":scope > pubsub > subscriptions")!);

// 错误响应：注册 XEP0060 后，pubsub 专有附加条件出现在 stanza.error.pubsub 上
if (iq.error?.pubsub?.condition === "node-full") // error.type / error.condition / error.text 为通用错误信息
if (iq.error?.pubsub?.feature === "instant-node") // §11.1 仅 <unsupported/> 带 feature
```

## 注意事项

- 命名空间分离：基础操作、事件通知、owner 操作、附加错误条件各占一个命名空间，构造方法已按 §5–§8 选好。
- 表单分两类：订阅选项等通用表单由 `form` 参数接受现成的 `<x xmlns='jabber:x:data'/>`，调用方负责 FORM_TYPE 与字段；`#node_config` 与 `#publish-options` 用 `createNodeConfigForm` / `createPublishOptionsEl` 构造，字段名与值域按 §16.4.4 注册项约束，FORM_TYPE、`type='submit'` 与 `pubsub#` 前缀由本模块写入。
- `<options/>` 的属性规则：单独使用时带 `node`/`jid`（§6.3.2），与 `<subscribe/>` 同处时不得带任何属性（§6.3.7），`createSubscribeIq` 已按此处理。
- 事件解析只认 `#event` 命名空间的直接子元素，载荷内层的同名元素不会被误收为通知项。
- 修改订阅/权限只提交增量，未给出 `subscription`/`affiliation` 的条目由服务保持不变。
- `retract` 的 `notify` 只有显式传 `true` 才要求服务通知订阅者（§7.2.2.1）。
- 本模块只做请求与解析，节点权限校验、订阅广播、通知投递属服务端义务。