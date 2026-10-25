# XEP-0486 — MUC 房间头像

基于 vCard PHOTO 设置/获取 MUC 房间头像。

- **依赖**：XEP-0054 / XEP-0153（vCard）、XEP-0084（图片解析）
- **实例访问**：`connection.XEP0486`

## 可配置项

无可配置项。

## 注册后行为

`init()` 为空实现，所有功能需主动调用。

## 扩展字段

不扩展 stanza。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `setAvatar(to, image?)` | 设置 MUC 房间头像（`File` 或绝对路径）；不传 `image` = 删除；失败抛 `XMPPError` |
| `getAvatar(to)` | 获取房间头像 → `VCardPhoto`（`{ binval, type }`）；失败抛 `XMPPError` |
| `XEP0486.createSetAvatarIq(to, image?)`（静态） | 构造设置头像 IQ |
| `XEP0486.createGetAvatarIq(to)`（静态） | 构造获取头像 IQ |

## 使用示例

```typescript
// 设置房间头像 → Promise<XMPPElement>（不传 image 表示删除；失败抛 XMPPError）
await client.XEP0486!.setAvatar("room@conference.example.com", "./room.png");

// 获取房间头像 → VCardPhoto（binval 为 base64；失败抛 XMPPError）
const photo = await client.XEP0486!.getAvatar("room@conference.example.com");
```

## 注意事项

- 基于 **vCard PHOTO**（复用 XEP-0054 / XEP-0153）。
- `getAvatar()` 返回的 `binval` 是 base64 编码的图片数据。
- 需要用户对房间有相应权限。
- 规范 §3.1 要求先以 disco#info 确认服务含 `<feature var='vcard-temp'/>`，当前未探测（见 [debug.md](debug.md) ARCH-001）。
- 规范 §3.3/§3.4 的 `muc#roominfo_avatarhash` 发现路径（disco → 取 vCard → sha1 比对）未实现，`getAvatar()` 只取 PHOTO。