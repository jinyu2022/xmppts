# XEP-0054 — vCard-Temp

**Type: Historical**（文档 Status 仍为 Active，业界建议由 XEP-0292 承接），仅保留 vCard 基础类型与解析/构造方法供其他插件复用。

- **依赖**：无
- **实例访问**：无（纯静态工具类，不会被注册为插件实例）
- **规范版本**：1.3.0（2024-06-27）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，不会被 Connection 加载。仅提供 `VCardTemp.NS` 命名空间常量、`VCardTemp.parseVCard()` / `VCardTemp.createVCard()` 方法及 TypeScript 类型。

## 扩展字段

不扩展 stanza。本文件内定义（均未 `export`，外部按路径引入）的接口/类型：`VCard`、`N`、`Org`、`Adr`、`Label`、`Tel`、`Email`、`VCardPhoto`、`Sound`、`Key`、`Geo`、`Agent`，及 `TelType`、`AdrType`、`EmailType`、`VCardClass`。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `VCardTemp.parseVCard(el)`（静态） | 解析命名空间为 `vcard-temp` 的元素 → `VCard`；命名空间不符时抛普通 `Error` |
| `VCardTemp.createVCard(vcard)`（静态） | 依据 `VCard` 构造 vCard 元素，按 §9 DTD 顺序输出，`version` 缺省为 `"3.0"` |
| `VCardTemp.NS`（静态） | `"vcard-temp"` |
| `VCardTemp.VERSION`（静态） | `"3.0"`（§8 规定版本写成 `version` 属性） |

## 被引用方

- **XEP-0153** — vCard 头像（使用 `VCardTemp.NS` 命名空间）
- **XEP-0486** — MUC 头像（基于 vCard PHOTO）

## 使用示例

```typescript
import { VCardTemp } from "@/plugins/xep0054/vcardTemp";

// 解析 vcard-temp 元素 → VCard；命名空间不符时抛普通 Error
const vcard = VCardTemp.parseVCard(el);
console.log(vcard.fn, vcard.n?.given);

// 由 VCard 构造元素（→ XMPPElement）；fn 必填，version 缺省 "3.0"
const el2 = VCardTemp.createVCard({
  fn: "小明",
  n: { family: "小", given: "明" },
});
```

## 注意事项

- 个人头像应使用 **XEP-0084**，不要使用此模块。
- 按 §9 DTD，`TEL`/`ADR`/`EMAIL` 的类型是**空元素**（`<WORK/>`、`<VOICE/>`…），`<TYPE>` 只用于 `PHOTO`/`LOGO`/`KEY`（`SOUND` 无 `TYPE`）；解析时非规范的 `<TYPE>` 会 `log.warn`。
- 本模块仅存在于代码中，供 MUC 相关场景复用 vCard 基础类型。