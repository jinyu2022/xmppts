# XEP-0084 — 用户头像

基于 PEP 的个人头像发布与获取。

- **依赖**：XEP-0030（服务发现）、XEP-0163（PEP）；源码 `dependencies` 目前只声明 XEP-0030，单独注册本插件时 `pep:avatar` 不会触发（见 debug CORR-001）
- **实例访问**：`connection.XEP0084`

## 可配置项

无可配置项。

## 注册后行为

`init()` 执行以下动作：

1. **声明能力** — `addFeature("urn:xmpp:avatar:metadata+notify")`。
2. **注册 disco 子项** — 向 XEP-0030 注册 `urn:xmpp:avatar:data` 与 `urn:xmpp:avatar:metadata`。
3. **注册 metadata 解析器** — 解析命名空间 `urn:xmpp:avatar:metadata` 的元素。
4. **注册 `pep:avatar` 事件** — 匹配 `message.event.node === metadata`。

## 扩展字段

```typescript
interface PubsubEventItem {
  metadata?: AvatarMetadata | null;   // XEP-0084 添加；空 <metadata/> 时为 null
}

interface AvatarMetadata {
  id: string;      // SHA-1 哈希
  type: string;    // MIME 类型
  bytes: number;
  width?: number;
  height?: number;
  url?: string;
}
```

## 可监听事件

| 事件 | 触发条件 | 回调参数 |
|------|---------|----------|
| `pep:avatar` | 收到头像元数据更新的 PEP 通知 | `Message`（`event.node === metadata`）；类型上为可选 `Message` |

## 公开 API

| 方法 | 说明 |
|------|------|
| `getAvatarData(jid: JID \| string, metadata?)` | 获取用户头像 → `(AvatarMetadata & { data?: string }) \| undefined \| null`（`data` 为 base64）；服务器报错抛 `XMPPError`，无 metadata 时的解析失败抛普通 `Error` |
| `publishAvatarData(img: File \| string)` | 发布自己的头像（`File` 或绝对路径），依次发送 data 与 metadata 两个 IQ |
| `XEP0084.NS`（静态） | `{ data, metadata }` 命名空间常量 |
| `XEP0084.imageParser(image)`（静态） | 图片 → `{ base64Data, metadata }`（Node 路径 / 浏览器 `File`）；环境判定失败抛 `Error` |
| `XEP0084.createDataPublishIq(img)`（静态） | 构造 `[dataIq, metadataIq]`；仅接受 PNG |
| `XEP0084.parseMetadataEl(el)`（静态） | 解析 metadata 元素 → `{ metadata: AvatarMetadata \| null }`；NS 不符抛 `Error`（会中断 stanza 分发） |
| `XEP0084.createRetrieveDataIq(to, id)`（静态） | 构造按 ItemID 取 `data` 节点的 IQ |

## 返回值约定

插件区分「元素不存在」与「元素存在但为空」：`undefined` 表示对应元素不存在，`null` 表示对应元素存在但为空。

- `parseMetadataEl` 的返回形状固定为 `{ metadata }`：`<metadata>` 存在但没有 `<info>` 子元素时 `metadata` 为 `null`。因为形状稳定，它可直接作为 stanza 转换器使用。
- `getAvatarData`：响应中无 `<metadata>` 元素 → 返回 `undefined`；`<metadata>` 存在但为空 → 返回 `null`；`<data>` 元素缺失 → 返回对象的 `data` 为 `undefined`。

## 使用示例

### 发布自己的头像

```typescript
// 接受 PNG 路径或浏览器 File；依次发送 data 与 metadata 两个 IQ → Promise<void>
await client.XEP0084!.publishAvatarData("./avatar.png");
```

### 获取他人头像

```typescript
// → Promise<AvatarMetadata & { data?: string } | undefined | null>（失败抛 XMPPError）
const avatar = await client.XEP0084!.getAvatarData("friend@example.com");
if (avatar?.data) {
  const src = `data:${avatar.type};base64,${avatar.data}`;
}
```

### 监听头像更新

```typescript
client.on("pep:avatar", (message) => {
  const metadata = message.event?.item?.metadata;
  if (metadata) console.log(metadata.id, metadata.type, metadata.bytes);
});
```

## 注意事项

- 发布头像仅支持 **PNG**（`createDataPublishIq` 直接抛错，不做格式转换）。
- `getAvatarData()` 不传 `metadata` 时会先检索元数据；返回的 `data` 为 base64。
- 环境按运行时自动选择图片解析方式；Node 20+ 传 `File` 对象目前会被判失败（需 `window` 存在）。
- 收通知需在 disco/caps 声明 `urn:xmpp:avatar:metadata+notify`；插件已 `addFeature`（见 debug CORR-001）。
- 未实现：§3.5 禁用头像（发布空 `<metadata/>`）、§3.4 `url` 的 HTTP 回退、§4.2.2 `<pointer/>`、多 `<info/>`（只取第一个，见 debug CORR-002）。
- 头像变更通过 `pep:avatar` 事件接收，需自行处理 UI 更新。