# XEP-0059 — 结果集管理（Result Set Management）

为需要分页的查询协议提供 `<set/>` 请求构造与响应解析，供 XEP-0313（MAM）等协议复用。

- **依赖**：无
- **实例访问**：无（纯工具类，不登记在 `pluginLoaders`）

## 可配置项

无可配置项。

## 公开 API

| 方法 | 说明 |
|------|------|
| `RSM.NS`（静态） | `"http://jabber.org/protocol/rsm"` |
| `RSM.createSetEl(request)`（静态） | 构造 `<set/>` 请求，全部参数省略时得到空 `<set/>` |
| `RSM.parseSetEl(el)`（静态） | 解析 `<set/>` → `{ rsm }`；也可直接传入包含 `<set/>` 的父元素 |

## 类型

```typescript
interface RsmRequest {
  max?: number;      // 每页最大条数，0 表示只取总数
  after?: string;    // 从该 UID 之后开始，向前翻页
  before?: string;   // 从该 UID 之前开始，向后翻页；空串表示最后一页
  index?: number;    // 从该索引开始，乱序取页
}

interface RsmResult {
  first?: { value: string; index?: number };  // 本页第一条及其在完整结果集中的位置
  last?: string;                              // 本页最后一条
  count?: number;                             // 完整结果集条数，可能为近似值
}
```

## 使用示例

```typescript
import { RSM } from "@/plugins/xep0059/rsm";

// 第一页
const firstPage = RSM.createSetEl({ max: 20 });
// 向前翻页：取上一页最后一条的 UID
const nextPage = RSM.createSetEl({ max: 20, after: "09af3-cc343-b409f" });
// 最后一页
const lastPage = RSM.createSetEl({ max: 20, before: "" });
// 只取总数
const countOnly = RSM.createSetEl({ max: 0 });

// 解析响应中的分页信息
const { rsm } = RSM.parseSetEl(setEl);
```

## 注意事项

- UID 对客户端不透明，不能按内容解析或推断顺序。
- `<max>0</max>` 只返回 `count`，不返回条目。
- `count` 与 `first@index` 都是可选的，服务器可以省略（XEP-0059 §2.2）。
- 同时提供 `after` 与 `before` 的行为未在规范中定义；需要取两个 UID 之间的区间时，改用 MAM 的 `before-id` / `after-id` 字段。
