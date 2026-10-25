# XEP-0128 — 服务发现扩展

在 disco#info 响应中携带 XEP-0004 表单的解析工具。

- **依赖**：无外部依赖；模块内使用 XEP-0004 的 `Form`（`Form.NS` / `parseFormEl`）
- **实例访问**：无（纯静态工具类，不会被注册为插件实例）

## 可配置项

无可配置项。

## 注册后行为

不实现 `Plugin` 接口，不会被 Connection 加载。由 **XEP-0030 的 `Disco.parseDiscoInfo()`** 在解析 disco 响应时内部调用。

## 扩展字段

不直接扩展 stanza。XEP-0030 `getDiscoInfo()` 返回值的 `extensions` 字段即来自本模块的解析结果。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0128.parseDataForm(xml)`（静态） | 解析 XEP-0004 扩展表单 → `{ form: DataForm \| undefined }`；`xml` 为 `<query>` 时自动取其下首个 `jabber:x:data` 的 `<x>`，也可直接传 `<x>` 自身；`xml` 传 `undefined` 时抛 `TypeError` |

## 使用示例

```typescript
import { XEP0128 } from "@/plugins/xep0128";

// → { form: DataForm | undefined }（无扩展表单时 form 为 undefined；xml 为 undefined 会抛 TypeError）
const { form } = XEP0128.parseDataForm(queryEl);
```

## 注意事项

- **走 XEP-0030 时无需单独导入** — 功能已集成在 `Disco.parseDiscoInfo()` 中；直接调用才需深层导入 `@/plugins/xep0128`。
- disco 响应不含扩展表单时返回 `{ form: undefined }`。
- 只取 `<query>` 下第一个 `jabber:x:data` 的 `<x>`（§4 允许一次携带多个扩展表单），且不校验表单的 `FORM_TYPE`（见 debug CORR-002、CORR-003）。