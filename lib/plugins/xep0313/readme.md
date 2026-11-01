# XEP-0313 — 消息归档管理（Message Archive Management）

查询账户或 MUC 房间的服务端消息归档，用于加载历史消息、多端同步与断线补拉。

- **依赖**：XEP-0004（数据表单）、XEP-0030（服务发现）
- **实例访问**：`connection.XEP0313`

## 可配置项

无可配置项。查询条件通过各方法的参数传入。

## 注册后行为

`init()` 只向 XEP-0030 添加 `urn:xmpp:mam:2` 特性，不发送任何节，也不注册 stanza 转换器——MAM 没有服务端主动推送，结果只在本插件的查询期间到达：

1. **查询期间监听结果** — 每次查询在发出前注册 `message` 监听器，直接解析命名空间为 `urn:xmpp:mam:2` 的 `<result/>`，只处理回显本次 `queryid` 的结果，并在 `fin` 到达或失败后于 `finally` 中解绑。
2. **响应直接解析** — `<fin/>` 与 `<metadata/>` 由对应方法从 IQ 响应中解析，不依赖全局转换器。

## 可监听事件

无专门事件。结果通过 `queryArchive()` 的返回值、`onResult` 回调或 `iterateArchive()` 交付。

## 公开 API

| 方法 | 说明 |
|------|------|
| `queryArchive(archive, options?, onResult?)` | 查询并返回完整一页：`{ results, fin }` |
| `iterateArchive(archive, options?)` | 查询并返回 `AsyncIterableIterator<MamResult>`，按推送顺序逐条产出 |
| `queryMetadata(archive?)` | 查询归档首尾消息，需服务端声明 `#extended` |
| `queryFormFields(archive?)` | 查询服务端支持的查询字段，返回 `DataForm` |
| `XEP0313.NS`（静态） | `"urn:xmpp:mam:2"` |
| `XEP0313.NS_EXTENDED`（静态） | `"urn:xmpp:mam:2#extended"` |
| `XEP0313.NS_GROUPCHAT_FIELD`（静态） | `"urn:xmpp:mam:2#groupchat-field"` |
| `XEP0313.createQueryIq(archive, options, queryid)`（静态） | 构造查询 IQ |
| `XEP0313.parseResultEl(el)` / `parseFinEl(el)` / `parseMetadataEl(el)`（静态） | 解析对应元素 |
| `XEP0313.createMetadataIq(archive?)` / `createFormFieldsIq(archive?)`（静态） | 构造元数据 / 字段发现 IQ |

### 查询参数

`archive` 是查询目标，作为第一个位置参数传入：账户归档传自身 bare JID，MUC 归档传房间 bare JID。`options` 只放 §4 定义的表单字段与分页参数。

```typescript
interface MamQueryOptions {
  with?: string | JID;         // 只返回与该 JID 收发的消息
  start?: Date;                // 起始时间，含
  end?: Date;                  // 截止时间，含
  beforeId?: string;           // 只返回该 UID 之前的消息，需 #extended
  afterId?: string;            // 只返回该 UID 之后的消息，需 #extended
  ids?: string[];              // 只返回这些 UID 的消息，需 #extended
  includeGroupchat?: boolean;  // 是否包含 groupchat 消息，需 #groupchat-field
  page?: RsmRequest;           // 分页参数，见 XEP-0059
  flip?: boolean;              // 倒序推送页内结果，需 #extended
}

interface MamResult {
  id: string;        // 归档 UID，按不透明字符串对待
  stamp?: Date;      // 入库时间
  message: Message;  // 被归档的原始消息
}

interface MamFin {
  complete: boolean; // 结果集是否已完整返回，缺省 false
  stable: boolean;   // 结果是否稳定，缺省 true
  rsm?: RsmResult;   // 分页信息
}
```

## 使用示例

### 加载最近的 20 条

```typescript
const page = await client.XEP0313!.queryArchive("juliet@capulet.lit", {
  with: "romeo@montague.lit",
  page: { max: 20, before: "" },
});
for (const item of page.results) {
  render(item.message, item.stamp);
}
```

### 向前翻页

```typescript
const older = await client.XEP0313!.queryArchive("juliet@capulet.lit", {
  with: "romeo@montague.lit",
  page: { max: 20, before: page.fin.rsm!.first!.value },
});
```

### 逐条写入本地库

```typescript
const page = await client.XEP0313!.queryArchive(
  "juliet@capulet.lit",
  { page: { max: 200 } },
  (item) => db.put(item),
);
```

### 异步迭代

```typescript
const iterator = client.XEP0313!.iterateArchive("juliet@capulet.lit", {
  page: { max: 50 },
});
for await (const item of iterator) {
  await db.put(item);
  if (enough) break; // 提前退出后不再产出，服务器仍会推送到 fin
}
```

### 查询 MUC 归档

```typescript
const history = await client.XEP0313!.queryArchive(
  "coven@chat.shakespeare.lit",
  { page: { max: 50, before: "" } },
);
```

### 归档元数据

```typescript
const { start, end } = await client.XEP0313!.queryMetadata("juliet@capulet.lit");
```

## 注意事项

- **惰性启动**：`iterateArchive()` 返回的迭代器在首次 `next()` 时才发出查询，拿到后应立即消费；`queryArchive()` 则立即发出。
- **来源校验**：归档结果必须来自被查询的归档地址（XEP-0313 §9.2）。`queryid` 不是本次查询的、或 `from` 的 bare JID 与归档地址不符的结果会被丢弃并 warn，不会进入返回值或回调。
- **并发查询**：每次查询持有独立的监听器，只收集自己 `queryid` 的结果，结束后立即解绑，互不干扰。
- **能力探测**：用到 `beforeId`、`afterId`、`ids`、`flip` 时，插件先通过 XEP-0030 查询归档地址的 disco#info 并确认 `urn:xmpp:mam:2#extended`；用到 `includeGroupchat` 时确认 `urn:xmpp:mam:2#groupchat-field`。缺少声明时直接抛 `Error`，不会发出查询。disco 结果由 XEP-0030 缓存，重复使用不会每次往返。普通分页（`max` / `after` / `before` / `index`）不触发探测。
- **元数据能力**：`queryMetadata()` 依赖 `urn:xmpp:mam:2#extended`，服务端不支持时由错误节转成 `XMPPError`。
- **倒序页面**：`flip: true` 时服务器按时间倒序推送页内结果，`results` 也按该顺序保存；它只改变推送顺序，不改变返回哪些条目。
- **不自动翻页**：一次调用只取一页，用 `fin.rsm` 决定是否继续，避免在超大归档上产生不受控的连续请求。
- **不稳定结果**：`fin.stable === false` 表示服务端数据可能尚未收敛，长期缓存前应重新查询确认。
- **每页上限**：服务器可以强制小于 `max` 的页大小，实际条数以收到的结果为准。
