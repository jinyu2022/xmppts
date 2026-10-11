# XEP-0045 — 多用户聊天（MUC）

多人聊天室：加入/离开房间、维护房间住户状态、发送群聊消息、管理身份与角色。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0045`

## 可配置项

无可配置项。

## 注册后行为

加载此插件后，Connection 会自动：

1. **注册 disco 特性** — 向 XEP-0030 注册 `http://jabber.org/protocol/muc`
2. **注册 `muc#user` 解析器** — 自动把 presence/message 中的 muc 扩展解析到 `muc` 字段
3. **注册 MUC 事件** — 见「可监听事件」
4. **维护房间状态** — 通过全局 `presence` 监听维护 `rooms`（见下）
5. **声明依赖 XEP0030** — `static dependencies = ["XEP0030"]`

## 类属性

### 实例属性

#### `rooms`

类型：`Map<string, RoomState>`

```typescript
interface RoomState {
  /** 当前会话在该房间使用的昵称 */
  nick: string;
  /** 房间内 occupant，键为完整 occupant JID */
  occupants: Map<string, MUCUser>;
  /** 加入时使用的房间密码（如有） */
  password?: string;
}

interface MUCUser {
  jid?: string;                  // 真实 JID（半匿名房间可能缺省）
  nick: string;                  // occupant 的昵称
  affiliation?: MUCAffiliation;  // occupant 的身份
  role?: MUCRole;                // occupant 的角色
}
```

`rooms` 以 **bare room JID**（如 `room@conference.example`）为键，由全局 `presence` 监听自动维护：

| 时机 | 行为 |
|------|------|
| 收到带 `muc.item` 的 available presence（非 error） | 房间条目不存在时自动创建，并登记/更新 `occupants` 中的该用户 |
| 收到带 `muc.item` 的他人 unavailable presence | 从 `occupants` 移除该用户（离开、被踢/禁、改名的旧昵称均走此路径） |
| 自身 available presence（含 110） | 更新房间的 `nick` |
| 自身 unavailable 且含 110（非 303） | 删除整个房间条目 |
| 自身改名 unavailable（110 + 303） | 仅移除旧昵称，保留房间 |

不含 `muc.item` 的 presence 与 `type='error'` 的 presence 会被跳过。

`occupants` 以 **完整 room JID**（如 `room@conference.example/nick`）为键。`kick()` / `ban()` 发出 IQ 成功后，实际的移除由服务端随后下发的 307/301 presence 完成。

### 静态常量（MUC 基类）

| 常量 | 值 | 说明 |
|------|-----|------|
| `NS.BASE` | `http://jabber.org/protocol/muc` | MUC 核心命名空间 |
| `NS.USER` | `http://jabber.org/protocol/muc#user` | 用户扩展命名空间 |
| `NS.ADMIN` | `http://jabber.org/protocol/muc#admin` | 管理 IQ 命名空间 |
| `NS.OWNER` | `http://jabber.org/protocol/muc#owner` | 所有者 IQ 命名空间 |
| `ROLE` | `["none", "visitor", "participant", "moderator"]` | 合法角色值 |
| `AFFILIATION` | `["none", "outcast", "member", "admin", "owner"]` | 合法身份值 |

### 静态方法（MUC 基类）

| 方法 | 说明 |
|------|------|
| `createJoinPres(room, nick, options?)` | 构造加入 presence（§7.2） |
| `createLeavePres(occupantJid, reason?)` | 构造离开 presence（§7.14） |
| `createSetNickPres(room, nick)` | 构造改名 presence（§7.6） |
| `createMediatedInvite(room, to, reason?)` | 构造邀请 message（§7.8.2） |
| `createGetReservedNickIq(room)` | 查询预留昵称（§7.12） |
| `createRequestVoiceMsg(room)` | 构造发言权请求 message（§7.13） |
| `createSetSubjectMsg(room, subject)` | 构造主题 message（§8.1） |
| `createSetAffiliationIq(room, jid, aff, reason?)` | 构造身份变更 IQ（§9） |
| `createSetRoleIq(room, nick, role, reason?)` | 构造角色变更 IQ（§8） |
| `createGetRoomConfigIq(room)` / `createSetRoomConfigIq(room, form)` | 房间配置 IQ（§10） |
| `parsePresUser(xEl)` | 解析 `muc#user`（插件注册后自动调用） |

## 扩展字段

presence / message 中出现 `muc#user` 扩展时会被解析到 `muc` 字段（类型见 [typing.ts](typing.ts)）：

**Presence**：

```typescript
interface Presence {
  muc?: {
    item?: MUCItem;        // jid / nick / affiliation / role / actor / reason
    statuses?: string[];   // MUC 状态码列表（如 110、303、307、301）
    destroy?: MUCDestroy;  // 房间被销毁时（§10.9）
  }
}
```

**Message**：

```typescript
interface Message {
  muc?: {
    invites?: MUCInvite[];  // 邀请（§7.8.2）
    decline?: MUCDecline;   // 拒绝邀请（§7.8.3）
    password?: string;      // 密码保护房间的邀请附带
    statuses?: string[];
    item?: MUCItem;
  }
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `muc:join` | 住户首次出现（含本人加入、他人加入、改名后的新昵称；本人含 status 110） | Presence |
| `muc:leave` | 已记录住户的 unavailable（含本人离开、他人离开、改名的旧昵称） | Presence |
| `muc:groupchat` | type='groupchat' 且有 body | Message |
| `muc:subject` | type='groupchat' 有 subject 无 body（未排除带 `<thread/>` 的，§8.1 也要求忽略） | Message |
| `muc:kick` | type='unavailable' 且 status 码 307（任何住户被踢，本人另含 110） | Presence |
| `muc:ban` | type='unavailable' 且 status 码 301（任何住户被封禁，本人另含 110） | Presence |
| `muc:destroy` | 房间被销毁（presence 含 destroy 信息，§10.9） | Presence |
| `muc:mediated-invite` | message 携带 `<x><invite/>`（§7.8.2） | Message（`muc.invites`） |
| `muc:decline` | message 携带 `<x><decline/>`（§7.8.3） | Message（`muc.decline`） |
| `muc:voice-request` | 收到发言权审批表单（type=form 且 FORM_TYPE 为 `muc#request`，§8.6） | Message |

存在类事件（`muc:join` / `muc:leave` / `muc:kick` / `muc:ban`）对全房间任何住户触发，**包括本人**；判断是否本人看 presence 的 `statuses` 是否含 110，或 `from` 是否等于自身的 occupant JID。其中 `muc:join` / `muc:leave` 依据 `rooms.occupants` 判定真实的“首次出现/消失”，显示状态更新不会误报；改名会成对触发 `muc:leave`（旧昵称）+ `muc:join`（新昵称），可用 303 识别。该判定依赖事件插件 matcher 先于全局 `presence` 处理器执行（[connection.ts#L583-L587](../connection.ts#L583-L587) 的 matcher 在 [connection.ts#L553](../connection.ts#L553) 的 `emit("presence")` 之前），调整注册顺序会导致 matcher 读到更新后的状态。

## API

| 方法 | 说明 |
|------|------|
| `join(room, nick, options?, timeout?)` | 加入房间；options：`maxchars` / `maxstanzas` / `seconds` / `since` / `password` |
| `leave(roomJid, reason?)` | 离开房间 |
| `setNick(room, nick)` | 修改昵称 |
| `requestVoice(room)` | 请求发言权（§7.13） |
| `setSubject(room, subject)` | 设置主题（§8.1） |
| `kick(room, nick, reason?)` | 踢出用户（需 moderator+） |
| `ban(room, jid, reason?)` | 封禁用户（需 admin+） |
| `getRoomConfig(room)` | 获取房间配置 DataForm |
| `setRoomConfig(room, form)` | 修改房间配置（需 owner） |
| `createPrivateRoom(room, roomName)` | 创建成员制 + 审核的私有房间 |
| `createPublicRoom(room, roomName)` | 创建公开房间 |

除 `join()` 外，各方法都要求已加入对应房间（多数经内部 `requireJoined` 校验；`leave()` 自检、`create*Room()` 经 `getRoomConfig` 间接校验）。

## 使用示例

### 加入 / 离开房间

```typescript
// 加入：以收到 self-presence（status 110）为成功标志
// → Promise<...>；超时抛 TimeoutError，错误应答抛 XMPPError
await client.XEP0045!.join("room@conference.example.com", "小明", { password: "s3cret" });

// → Promise<void>
await client.XEP0045!.leave("room@conference.example.com", "先撤了");
```

### 房间内操作

```typescript
// 修改昵称 → Promise<Presence>
await client.XEP0045!.setNick("room@conference.example.com", "小明明");

// 设置主题 → Promise<void>
await client.XEP0045!.setSubject("room@conference.example.com", "今日话题");

// 踢人（moderator+）/ 封禁（admin+）→ Promise<void>
await client.XEP0045!.kick("room@conference.example.com", "捣乱者", "刷屏");
await client.XEP0045!.ban("room@conference.example.com", "spammer@example.com");
```

### 房间配置

```typescript
// 获取配置 → Promise<DataForm>
const form = await client.XEP0045!.getRoomConfig("room@conference.example.com");
// 修改配置（owner）→ Promise<void>
await client.XEP0045!.setRoomConfig("room@conference.example.com", form);
```

### 监听群聊事件

```typescript
client.on("muc:groupchat", (message) => {
  console.log(message.from, message.body);
});

client.on("muc:join", (presence) => {
  const isSelf = presence.muc?.statuses?.includes("110");
  console.log(presence.from, isSelf ? "自己" : "他人", "加入了房间");
});
```

## 注意事项

- status 码 **110** 表示 presence 指向自己；类事件对任何人触发，用 `statuses` 含 110 或自身 occupant JID 比对来区分自己
- 101 = 不在房间期间成员身份发生变化（由房间以 message 下发）
- `rooms` 的增删由全局 presence 监听完成：自身离开删除整个房间条目；他人离开、被踢/被禁移除对应 occupant
- 发送群聊消息需自行构造 `type='groupchat'` 的 message 发往房间 bare JID（无便捷发送方法）
- 目前主流服务器实现中会对message消息回传，且id保持一致，因此可以用 `sendAsync` 发送群聊消息并等待回传的 message 来确认发送成功（不保证所有服务器都这样）