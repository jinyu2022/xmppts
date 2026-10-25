# XEP-0077 — 带内注册

独立的账号注册工具：通过临时 socket 与服务器协商，查询注册表单并提交注册。仅覆盖 §3.1 注册流程，不含注销（§3.2）与改密码（§3.3）。

- **依赖**：无外部 npm 依赖；内部依赖 XEP-0004（`Form`）、XEP-0368 / XEP-0156（动态导入）
- **实例访问**：`new XEP0077()`（不走插件系统，无 `connection.XXX` 访问）

## 可配置项

无可配置项。构造函数不接收参数。

## 注册后行为

**不通过 Connection 插件系统加载**（未登记在 `pluginLoaders` 中）。`init()` 为空实现，需直接 `new XEP0077()` 后自行调用 `connectSocket()`。

## 扩展字段

不扩展 stanza。

## 可监听事件

无。流程通过 `connectSocket()` → `getRegistrationForm()` → `register()` 的顺序调用完成。

## 公开 API

| 方法 | 说明 |
|------|------|
| `connectSocket(domain, protocol)` | 建立独立 socket 连接 → `Promise<void>`；`protocol` 为 `"xmpps" \| "ws"`（ws 当前抛错） |
| `getRegistrationForm()` | 获取服务器注册表单 → `Promise<DataForm \| null>`（不支持时返回 `null`） |
| `register(username, password, captcha?, challenge?)` | 提交注册信息创建新账户 → `Promise<boolean>`；失败抛 `XMPPError`（空 password 抛裸 `Error`）。`challenge` 仅在缓存表单含该字段且取到值时才覆盖显式参数 |
| `register(iq)` | 重载：直接提交构造好的 IQ；此重载不使用 `password`/`captcha`/`challenge` |
| `sendAsync(data, timeout?)` | 发送 IQ 并等待响应（默认超时 10s）→ `Promise<XMPPElement>`；id 缺失时自动生成，未连接 reject `Error`、超时 reject `DOMException`（name 为 `TimeoutError`） |
| `setListener()` | 绑定 socket 事件与解析器（`connectSocket()` 内自动调用） |
| `parse(data)` | 把原始数据喂给常驻 XML 解析器 |
| `XEP0077.createSubmitFormEL(username, password, captcha?, challenge?)`（静态） | 构造注册提交 IQ；`captcha`/`challenge` 写为服务器方言字段 `ocr`/`challenge`（非 §13.4.1 登记字段） |
| `XEP0077.NS`（静态） | `"jabber:iq:register"` |

## 使用示例

```typescript
import XEP0077 from "@/plugins/xep0077";

const reg = new XEP0077();

// 建立独立连接 → Promise<void>
await reg.connectSocket("example.com", "xmpps");

// 查询注册表单 → Promise<DataForm | null>（服务器不支持/回固定字段时为 null）
const form = await reg.getRegistrationForm();
if (form) console.log(form.fields.map((f) => f.var));

// 提交注册 → Promise<boolean>（应答 result 为 true，否则抛 XMPPError）
const ok = await reg.register("newuser", "secret");
```

## 注意事项

- 此插件**不与 Connection 交互**，自行管理独立的 TLS socket。
- **WebSocket 注册通道当前不可用**：`connectSocket(domain, "ws")` 会抛错（shims 已移除，`WSconnection` 保留待重构）。
- 表单查询在收到 `stream:features` 后自动触发（§3.1、§8）；服务器也可回固定 username/password 字段而不下发 data form，此时返回 `null`；固定字段场景仍按 data form 提交（§6 优先级，见 debug CORR-004）。
- §5 重定向（`<instructions/>` + `x:oob`）不解析：无 data form 时一律以 `null` 结束，不区分场景；结果含 `<registered/>` 时也只看 `type='result'`。
- 提交只带 username/password（+ 可选 captcha/challenge）：服务器表单中的其他必填字段（§3.1 示例含 `first`/`last`/`email`）会被丢弃，可能被服务器拒绝（见 debug CORR-001）。
- 插件不含 SASL：注册成功后需另行建立 `Connection` 登录（§3.1.1）。
- `register()` 在服务器应答 `type='result'` 时返回 `true`，否则抛 `XMPPError`。
- 适用于账户注册场景，日常聊天不应使用此插件。