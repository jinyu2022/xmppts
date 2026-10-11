# XEP-0153 — vCard 头像（遗留方案）

基于 vCard 的头像方案，仅用于 MUC 等仍使用 vCard 头像的场景。

- **依赖**：XEP-0084（复用 `Avatar.imageParser`）、XEP-0054（`VCardTemp.NS` 命名空间）
- **实例访问**：无（纯静态工具类，不会被注册为插件实例）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，不会被 Connection 加载。

## 扩展字段

`declare module` 声明了 `Iq.vCard?: { photo?: VCardPhoto }`，但**未注册解析器**，运行时不会自动填充该字段。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0153.createSetVCardAvatarIq(to, image?)`（静态） | 构造 vCard 头像设置 IQ；不传 `image` = 删除头像 |
| `XEP0153.createUpdatePresence(to, hash)`（静态） | 生成含头像哈希的 presence **XML 字符串**；`hash` = **图片数据的十六进制 SHA-1**（非 base64），`to` 必填并强制写入 `to` 属性 |
| `XEP0153.parseVCardAvatar(stanza)`（静态） | 解析 vCard PHOTO → `VCardPhoto`；无 PHOTO 抛 `Error` |
| `XEP0153.NS`（静态） | `"vcard-temp:x:update"` |

```typescript
interface VCardPhoto {
  // 直接取自 <TYPE/>，未做运行时校验，可能是任意 MIME
  type: "image/gif" | "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  binval: string;  // base64 编码的图片数据
}
```

## 使用示例

静态方法经类本身调用：

```typescript
import { XEP0153 } from "@/plugins/xep0153";

// 设置头像 → Promise<Iq>（不传 image 表示删除头像）
const iq = await XEP0153.createSetVCardAvatarIq("user@example.com", image);

// 生成含哈希的 presence → XML 字符串（avatarHash = 图片数据的十六进制 SHA-1）
const presenceXml = XEP0153.createUpdatePresence("user@example.com", avatarHash);

// 解析 vCard PHOTO → VCardPhoto；无 PHOTO 抛 Error
const photo = XEP0153.parseVCardAvatar(vCardEl);
```

## 注意事项

- 个人头像**应使用 XEP-0084**，本方案是遗留的；主要用于 MUC 场景。
- 复用 XEP-0084 的 `Avatar.imageParser()` 处理图片。
- `createUpdatePresence()` 返回 **XML 字符串**，不是 `XMPPElement`。