# XEP-0402 — PEP 原生书签

通过 PEP（XEP-0163）在用户自己的 bare JID 上存储/同步群聊书签，并在登录时自动加入标记了 `autojoin` 的房间。

- **依赖**：XEP-0030（服务发现）、XEP-0163（PEP）、XEP-0060（`pubsub#errors` 解析器，用于识别节点配置类错误）；运行时可选用 XEP-0045（自动加入房间）与 XEP-0172（昵称回退）
- **实例访问**：`connection.XEP0402`

## 可配置项

无可配置项。

## 注册后行为

1. **注册 disco 特性** — 向 XEP-0030 添加 `urn:xmpp:bookmarks:1+notify`。
2. **注册 conference 解析器** — 用 `parseConferenceEl` 把 `urn:xmpp:bookmarks:1` 命名空间的 `<conference>` 解析为 `{ conference: Conference }`。
3. **注册事件**（均为 `tagName = "message"`，且来源必须是本账号的 bare JID）：
   - `bookmark:update` — 匹配 `event.node === "urn:xmpp:bookmarks:1" && event.item?.conference != null`，命中后按 item id 新增或替换 `bookmarks` 中的对应项
   - `bookmark:delete` — 匹配 `event.node === "urn:xmpp:bookmarks:1" && event.retracts != null`，命中后按 item id 从 `bookmarks` 中移除
4. **装载书签并自动加入房间** — 首次 `session:start` 时触发（`once`）：
   1. `retrieveBookmarks()` 拉取全部书签并写入 `this.bookmarks`，失败仅 `log.error` 并中止（与是否加载 XEP-0045 无关）；
   2. 未加载 XEP-0045 则到此为止；
   3. 筛选 `autojoin === true` 的书签，逐个 `XEP0045.join(room, nick, options)`，书签含 `password` 时以 `{ password }` 传入（XEP-0045 §7.2 进入密码房间所需的 `<password/>`）；
   4. 昵称回退：书签 `nick` → `XEP0172.getSelfNick()` → `connection.jid.local`；
   5. 单个房间加入失败仅 `log.error`，不中断其余房间。

   首次检索只在首次 `session:start` 执行；自动重连发出的 `reconnected` 不会重新触发（重连期间书签变更由 PEP 通知同步）。

## 发布选项与节点隐私

书签可能包含房间密码，XEP-0402 要求节点为私有节点。`addBookmark` / `editBookmark` 发布时携带 `<publish-options/>`（`FORM_TYPE` 为 `#publish-options`），前提条件取自 §3.3 Example 6：

| 字段 | 值 |
|------|-----|
| `pubsub#persist_items` | `true` |
| `pubsub#max_items` | `max` |
| `pubsub#send_last_published_item` | `never` |
| `pubsub#access_model` | `whitelist` |

服务端据此在发布前校验节点配置（XEP-0060 §7.1.5）。节点已存在且配置不满足前提条件时，服务端返回 `conflict` + `precondition-not-met`，插件不自动改配置、不自动重试，而是抛出 `XMPPError`；附加条件在 `error.pubsub.condition`（依赖 XEP-0060 的 `pubsub#errors` 解析器）。

后续动作由调用方决定，XEP-0402 §8 给出的两条路径都是「先配置节点，再发布」：

- 服务端不支持 publish-options（收到 `unsupported` 且 `feature="publish-options"`，或该元素被忽略）；
- 收到 `precondition-not-met`（既有节点配置与要求不符）。

两条路径都可调用 `configureBookmarkNode()` 提交 `#node_config` 表单（字段值与上表一致），成功后重新调用 `addBookmark` / `editBookmark`。该方法是显式操作，不会自动重发书签。

## 类属性

### `bookmarks`

类型 `Conference[]`，默认 `[]`，只读使用（改动它不会同步到服务端）。首次 `session:start` 时由检索结果填充；之后由 `bookmark:update` / `bookmark:delete` 通知按 item id 增量同步，本地 `addBookmark` / `editBookmark` / `deleteBookmark` 成功后同步更新。`retrieveBookmarks()` 只返回结果，不写入该属性。

## 扩展字段

```typescript
declare module "@/plugins/xep0060/pubsub" {
  interface PubsubEventItem {
    conference?: Omit<Conference, "jid">; // XEP-0402 添加；房间 JID 在 <item id> 上
  }
}

declare module "@/connection" {
  interface SocketEventMap {
    // 匹配器已保证来源、节点与载荷存在，故回调里无需断言
    "bookmark:update": Message & {
      event: PubsubEvent & {
        node: typeof Bookmarks.NS;
        item: { id: string; conference: Omit<Conference, "jid"> };
      };
    };
    "bookmark:delete": Message & {
      event: PubsubEvent & {
        node: typeof Bookmarks.NS;
        retracts: string[];
      };
    };
  }
}

interface Conference {
  /** 房间 JID；由 <item id="..."> 的 id 属性承载（XEP-0402 不再放在 <conference> 上），必填 */
  jid: string;
  /** 用户指定的群聊名称（备注）；客户端不应从 JID 自动生成 */
  name?: string;
  /** 登录时是否自动加入；仅属性为 "true" 时为真，缺省/其他值均为 false */
  autojoin?: boolean;
  /** 用户指定的群内昵称；缺省时回退到 XEP-0172 昵称 */
  nick?: string;
  /** 房间密码 */
  password?: string;
  /** 编辑时须原样保留的子元素（尤其未知元素）；即 `<extensions/>` 的子元素 */
  extensions?: XMPPElement[];
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 | 读取方式 |
|------|---------|----------|---------|
| `bookmark:update` | 收到来自本账号 bare JID（XEP-0163 §4.3.1）的 `urn:xmpp:bookmarks:1` 书签更新通知 | `Message`（载荷类型已收窄） | `message.event.item.conference`、`message.event.item.id` |
| `bookmark:delete` | 收到来自本账号 bare JID 的 `urn:xmpp:bookmarks:1` 书签撤回通知 | `Message`（载荷类型已收窄） | `message.event.retracts` |

来源校验用于排除联系人的同名 PEP 节点事件：书签节点位于本账号的 PEP 服务上，只有本账号发布的事件才是自己的书签。

`message.event` 由 XEP-0163 解析，结构见 [xep0163/readme.md](../xep0163/readme.md)；`event.items[]` 含全部项目，`event.item` 是首个项目的快捷方式。

## 公开 API

### 实例方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `retrieveBookmarks` | `() => Promise<Conference[]>` | 拉取所有书签；失败抛 `XMPPError`。**不会写入 `this.bookmarks`** |
| `addBookmark` | `(conference: Conference & { jid: string }) => Promise<void>` | 发布新书签，携带 `publish-options`；失败抛 `XMPPError`。成功后按 `jid` 写入 `this.bookmarks` |
| `editBookmark` | `(conference: Conference & { jid: string }) => Promise<void>` | 以相同 JID 重新发布（编辑），携带 `publish-options`；失败抛 `XMPPError`。成功后替换 `this.bookmarks` 中的对应项 |
| `deleteBookmark` | `(jid: string) => Promise<void>` | 撤回由 `jid` 标识的项目；失败抛 `XMPPError`。成功后从 `this.bookmarks` 中移除 |
| `configureBookmarkNode` | `() => Promise<void>` | 向自己的 bare JID 提交 `#node_config` 表单，把书签节点配置为白名单访问且持久化；失败抛 `XMPPError`。不自动重发书签 |

以上方法经 `connection.sendAsync()` 发送 IQ，须在会话建立后调用；`session:start` 之前发送会被静默丢弃或挂到超时。

## 使用示例

### 添加 / 编辑 / 删除书签

```typescript
// 添加：jid 必填，会作为 <item> 的 id 属性
// → Promise<void>（成功 resolve，失败抛 XMPPError）
await client.XEP0402!.addBookmark({
  jid: "room@conference.example.com",
  name: "开发组",
  autojoin: true,
  nick: "小明",
  password: "s3cret",
});

// 编辑：以相同 JID 重新发布即覆盖
// → Promise<void>（成功 resolve，失败抛 XMPPError）
await client.XEP0402!.editBookmark({
  jid: "room@conference.example.com",
  name: "开发组（已改名）",
  autojoin: true,
});

// 删除：撤回该 JID 对应的项目
// → Promise<void>（成功 resolve，失败抛 XMPPError）
await client.XEP0402!.deleteBookmark("room@conference.example.com");
```

### 检索书签

```typescript
// → Promise<Conference[]>（失败抛 XMPPError）
const bookmarks = await client.XEP0402!.retrieveBookmarks();
for (const b of bookmarks) {
  console.log(b.jid, b.name, b.autojoin, b.nick);
}
```

### 监听书签变更

```typescript
client.on("bookmark:update", (message) => {
  console.log("书签更新", message.event.item.conference.name);
});

client.on("bookmark:delete", (message) => {
  console.log("书签删除", message.event.retracts);
});
```

### 编辑时保留未知子元素

`editBookmark` 传入完整对象即可；不要凭空构造新对象，否则会丢掉 `extensions` 中承载的未知子元素：

```typescript
const [existing] = await client.XEP0402!.retrieveBookmarks();
await client.XEP0402!.editBookmark({ ...existing, name: "新名称" });
```

## 注意事项

- 仅当 **XEP-0045** 已加载时才会自动加入房间；未加载时只装载 `bookmarks`，不加入任何房间。
- `autojoin` 缺省为 false，只有 `<conference autojoin="true">` 才会触发自动加入。
- 自动加入会把书签中的 `password` 作为 `XEP0045` 的 `JoinOptions.password` 传入；书签没有密码时不传该选项。
- `extensions` 是 `<extensions/>` 的子元素数组；解析结果里不含 `<extensions/>` 本身，`editBookmark` 重新发布时会补回这层包装。
- `bookmarks` 首次由 `session:start` 的检索填充，之后随通知与本地增删改保持同步；自动重连不重新检索（重连期间的变化由通知补齐）。
- 自动加入失败仅打印 error，不阻断连接。
- 「编辑」的语义是以相同 JID 重新发布项目，「删除」的语义是撤回项目（XEP-0402 §3.2）。