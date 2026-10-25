# XEP-0004 — 数据表单

数据表单的基础工具：在 `<x xmlns="jabber:x:data">` 与 `DataForm` 对象之间双向转换。多数需要表单的 XEP 都依赖它。

- **依赖**：无
- **实例访问**：`connection.XEP0004`

## 可配置项

无可配置项。

## 注册后行为

`init()` 为空实现。插件不注册任何解析器、监听器或拦截器，只把 `Form` 的静态方法暴露给其他插件调用。

## 扩展字段

不扩展 stanza 接口。其他 XEP（如 XEP-0077、XEP-0128）在各自的解析逻辑中调用 `Form.parseFormEl()`，把结果挂到自己的字段上。

## 可监听事件

无。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0004.parseFormEl(xml)`（静态） | 解析 `<x xmlns="jabber:x:data">` → `{ form: DataForm }` |
| `XEP0004.createFormEl(data)`（静态） | 由 `DataForm` 生成 `<x>` 元素 |
| `XEP0004.NS` / `XEP0004.FIELD`（静态） | 命名空间常量 / 字段元素名 |

### DataForm 结构

```typescript
interface DataForm {
  type: "cancel" | "form" | "result" | "submit";
  title?: string;
  instructions?: string;
  fields: Field[];
  reported?: Field[];
  items?: { fields: Field[] }[];
}

interface Field {
  type?: FieldType;   // boolean / hidden / list-single / text-single 等；缺省/未知按 §3.3 兜底为 text-single
  var?: string;
  label?: string;
  desc?: string;
  required?: boolean;
  values: string[];
  options?: Option[]; // 运行时仅 list-single / list-multi 保留；类型层面当前对所有字段成立
}
```

## 使用示例

`parseFormEl` / `createFormEl` 是静态方法，经类本身调用（非实例）：

```typescript
import { XEP0004 } from "@/plugins/xep0004";

// 解析收到的 <x xmlns="jabber:x:data">
// → { form: DataForm }；命名空间不符时抛普通 Error
const { form } = XEP0004.parseFormEl(xEl);
console.log(form.type, form.fields.map((f) => f.var));

// 由对象构造 <x> 元素
// → XMPPElement
const el = XEP0004.createFormEl({
  type: "submit",
  fields: [{ var: "nick", values: ["小明"] }],
});
```

## 注意事项

- 不执行网络操作，只做 XML ↔ 对象转换。
- `values` 保留每个直接 `<value/>` 的文本：没有 value 为 `[]`，空 value 为 `[""]`，`text-multi` 的首尾及中间空行均可往返保留。空值的业务含义由使用该表单的上层协议决定。
- 通常无需直接使用，由依赖它的插件内部调用。
- `parseFormEl` 结构缺失时抛 `TypeError`（`undefined` 入参、`<option/>` 缺 `<value/>`；后者见 debug CORR-003），命名空间不符抛普通 `Error`。
- `instructions` 允许出现多次（§3），当前仅保留/输出首个（见 debug CORR-002）。
- `FORM_TYPE`（XEP-0068，`<field var="FORM_TYPE" type="hidden">`）需使用方自行扫 `fields` 读取，无便捷 API。
- `reported`/`items`：解析取首个 `reported` 与全部 `item`；`items` 无与 `reported` 的列引用（§3.4 要求 item 含 reported 的每个 field）；`createFormEl` 输出 `reported` 字段的 `<value/>`（§3.4 SHOULD NOT）；`reported` 先于 `item` 由输出顺序保证、无校验。