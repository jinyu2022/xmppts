# XEP-0363 — HTTP File Upload

通过 XMPP 请求上传槽，再用 HTTP PUT 上传文件并取得下载 URL。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0363`
- **规范版本**：1.2.0 (2025-06-17)

## 可配置项

```typescript
client.registerPlugin("XEP0363", { service: "upload.example.com" });
```

| 选项 | 说明 |
|------|------|
| `service` | 指定上传服务 JID；省略时通过 disco 自动发现 |

## 注册后行为

不向 disco#info 宣告任何特性；`urn:xmpp:http:upload:0` 表示“提供上传服务”，由上传服务自己宣告。会话建立后会自动发现并缓存服务配置，`discoverService(domain)` 可随时重新查询。

## 公开 API

| 成员 | 说明 |
|------|------|
| `uploadService`（只读属性） | 当前可用的上传服务；尚未发现或不可用时为 `null`，可用于控制上传入口的可见性 |
| `discoverService(domain)` | 查询指定实体是否为上传服务，返回 `{ jid, maxFileSize?, purposes }`；查询失败或未宣告时为 `null` |
| `requestSlot(service, filename, size, options?)` | 请求上传槽，返回 `{ put: { url, headers }, get: { url } }` |
| `upload(filename, data, options?)` | 完整流程：发现服务 → 请求 slot → HTTP PUT，返回下载 URL |
| `XEP0363.createRequestIqEl(service, filename, size, options?)`（静态） | 创建 IQ-get 上传槽请求 |
| `XEP0363.parseSlot(xml)`（静态） | 解析 slot 响应 |
| `XEP0363.NS` / `XEP0363.PURPOSE_NS`（静态） | `urn:xmpp:http:upload:0` / `urn:xmpp:http:upload:purpose:0` |

### 选项

`requestSlot` / `upload` 的选项：

```typescript
interface SlotRequestOptions {
  contentType?: string;                              // 默认 application/octet-stream
  purpose?: "message" | "profile" | "ephemeral" | "permanent";
  expireBefore?: Date;                               // ephemeral 用途必填
}
```

`upload` 额外支持 `service`（覆盖本次使用的服务）与 `signal`（中止上传的 `AbortSignal`）。未传 `service` 时使用 init 阶段缓存的服务，不会在上传流程里重新发现；缓存为空时直接抛错。

## 使用示例

```typescript
// 让插件自动发现服务并上传
const url = await client.XEP0363!.upload(
  "photo.jpg",
  new Uint8Array(buffer),
  { contentType: "image/jpeg" },
);
client.send(Message.createMessage("romeo@montague.lit", url));

// 上传头像，使用 profile 用途
const avatarUrl = await client.XEP0363!.upload("avatar.png", blob, {
  contentType: "image/png",
  purpose: "profile",
});

// 只请求 slot，自行处理 HTTP 上传
const slot = await client.XEP0363!.requestSlot(
  "upload.example.com",
  "file.bin",
  1024,
  { contentType: "application/octet-stream" },
);
```

## 数据与请求头

- `data` 支持 `Blob`、`ArrayBuffer`、`Uint8Array`；`Blob` 自带 `type` 时可省略 `contentType`。
- `Content-Length` 由 `fetch` 按 body 自动计算，不手动设置。
- slot 响应中的请求头只保留 `Authorization`、`Cookie`、`Expires`（大小写不敏感），其余忽略；值中的换行会被剥离（§4）。
- 多个同名头按服务端给出的顺序附加。

## 注意事项

- 自动发现查询本账号服务器域的 disco#items，只对 JID 含 `upload` 的条目再发 disco#info 确认宣告 `urn:xmpp:http:upload:0`；没有这样的条目即视为不可用。
- slot 中的 `put`/`get` URL 必须是 HTTPS，否则在解析阶段抛错（§4）。
- 上传前会用 disco#info 的 `max-file-size` 检查大小；服务端仍可能返回 `file-too-large`，此时抛出 `XMPPError`。
- 会话建立后会自动发现上传服务并缓存结果；配置了 `service` 时直接查询该服务。`upload` 未指定服务时只使用该缓存，不重复发现。
- `purpose` 非 `message` 时会检查服务是否宣告对应的 `urn:xmpp:http:upload:purpose:0#...` 特性。
- 未指定 `purpose` 时仍会显式发送 `<message xmlns='urn:xmpp:http:upload:purpose:0'/>`；规范定义它为默认用途，显式写出仅为完整性（§5.1）。
- 浏览器端需上传服务正确配置 CORS；`Cookie` 等头可能受浏览器限制，由浏览器决定是否发送。
- HTTP 非 2xx 视为上传失败并抛出 `Error`；网络错误与取消（`AbortError`）原样向上传播。
- 本插件只实现客户端，不处理服务端的上传请求。
