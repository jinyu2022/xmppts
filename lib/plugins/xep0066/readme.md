# XEP-0066 — Out of Band Data

在消息或出席中携带资源 URL（`<x xmlns="jabber:x:oob"><url/><desc/></x>`），常用于分享文件下载地址。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0066`
- **规范版本**：1.6（2026-07-08）

## 注册后行为

1. 向 XEP-0030 添加 `jabber:x:oob` 特性。
2. 注册 `<x/>` 解析器，结果写入 `message.oob` / `presence.oob`。

不注册专用事件，在常规 `message` / `presence` 事件里读取 `stanza.oob` 即可。

## 扩展字段

```typescript
interface OOBData {
  url: string;
  desc?: string;
}

interface Message { oob?: OOBData; }
interface Presence { oob?: OOBData; }
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `sendOOB(to, url, options?)` | 发送携带 OOB URL 的消息 |
| `XEP0066.createOobEl(url, desc?)`（静态） | 创建 `<x/>`，可附加到自己的 stanza |
| `XEP0066.createOobMessage(to, url, options?)`（静态） | 创建完整的消息 |
| `XEP0066.NS`（静态） | `"jabber:x:oob"` |

`options` 支持 `desc`（资源描述）、`body`（给不支持 OOB 的客户端显示的正文）与 `type`（默认 `chat`）。

## 使用示例

```typescript
// 分享下载地址
client.XEP0066!.sendOOB(
  "romeo@montague.lit",
  "https://upload.example.com/files/photo.jpg",
  { desc: "Photo", body: "https://upload.example.com/files/photo.jpg" },
);

// 收到时读取
client.on("message", (message) => {
  if (message.oob) console.log(message.oob.url, message.oob.desc);
});
```

## 注意事项

- `<url/>` 是规范要求的必填子元素；缺失时该 `<x/>` 被忽略并记录警告，不影响消息正文。
- 只解析 `<x/>` 的直接子元素，嵌套在其他元素里的 `url` 不属于 OOB 数据。
- URL 不限于 `http:`/`https:`，接收方应自行校验来源与内容，避免打开恶意资源（§6）。
- 规范中的 `jabber:iq:oob` 是旧式 IQ 文件传输，本插件不实现。
