# lib — XMPP 客户端库核心

面向浏览器与 Node.js 的 XMPP 协议库核心；扩展协议以插件形式实现。

## 目录结构

| 路径 | 说明 |
|------|------|
| `main.ts` | 内部入口（导出 `Client` / `XEP0077`）；包入口是根 `index.ts`（仅导出 `Client`） |
| `client.ts` | `Client` 类（继承 `Connection`，含便捷方法） |
| `connection.ts` | 核心：插件注册 / 拦截器 / Stanza 路由 / `sendAsync` |
| `stanza.ts` | `StanzaBase` / `Iq` / `Message` / `Presence` |
| `JID.ts` / `errors.ts` / `dns.ts` / `log.ts` / `types.ts` | JID、错误、DNS、日志、公共类型 |
| `ltx/` | XML 解析引擎（`Parser` / `LtxParser` / `XMPPElement`） |
| `transport/` | 传输层（TCP/TLS 管线、流协商），见 [transport/README.md](transport/README.md) |
| `auth/` | SASL/SCRAM 辅助（如 base64 工具） |
| `plugins/` | 插件实现（见下） |

> 连接生命周期与状态机见 [LIFECYCLE.md](LIFECYCLE.md)。


## 地址与命名空间

- [JID](JID.ts#L23) 的 `full` 在有 resource 时返回 `bare/resource`，无 resource 时返回 `bare`，不会追加空 `/`。
- **localpart 一律使用 XEP-0106 转义后的形式**：`JID.parse()` 检测到需转义的字符时自动 `escapeLocal`，库内拿到的都是转义形式——包括 [SASL](auth/sasl.ts#L124) 的 authcid（PLAIN 直接拼 `jid.local`，SCRAM 只在其上再做 RFC 5802 的 `=`/`,` 转义）。未经转义的原始用户名属于 UI 层，不要传进协议代码；需要展示给人时用 `XEP0106.unescapeLocal()`。此约定已与 XSF 确认。

## 已实现的协议

### 插件（登记在 `pluginLoaders`，可自动注册）

| 插件 | 名称 | 依赖 |
|------|------|------|
| [RFC6121](plugins/rfc6121/readme.md) | 即时消息与存在（花名册） | — |
| [XEP-0004](plugins/xep0004/readme.md) | 数据表单 | — |
| [XEP-0030](plugins/xep0030/readme.md) | 服务发现 | — |
| [XEP-0045](plugins/xep0045/readme.md) | 多用户聊天（MUC） | XEP-0030 |
| [XEP-0060](plugins/xep0060/readme.md) | 发布-订阅（PubSub，仅注册 `pubsub#errors` 解析器） | — |
| [XEP-0066](plugins/xep0066/readme.md) | 带外数据（OOB） | XEP-0030 |
| [XEP-0084](plugins/xep0084/readme.md) | 用户头像 | XEP-0030、XEP-0163（PEP 事件） |
| [XEP-0085](plugins/xep0085/readme.md) | 聊天状态通知 | XEP-0030 |
| [XEP-0115](plugins/xep0115/readme.md) | 实体能力 | XEP-0030 |
| [XEP-0163](plugins/xep0163/readme.md) | 个人事件协议（PEP） | XEP-0030 |
| [XEP-0171](plugins/xep0171/readme.md) | 语言翻译（客户端 + 可选的翻译机器人） | XEP-0030 |
| [XEP-0172](plugins/xep0172/readme.md) | 用户昵称 | XEP-0030、XEP-0163（PEP 事件） |
| [XEP-0184](plugins/xep0184/readme.md) | 消息回执 | XEP-0030 |
| [XEP-0198](plugins/xep0198/readme.md) | 流管理 | — |
| [XEP-0199](plugins/xep0199/readme.md) | XMPP Ping | XEP-0030 |
| [XEP-0203](plugins/xep0203/readme.md) | 延迟投递 | — |
| [XEP-0280](plugins/xep0280/readme.md) | 消息碳副本 | XEP-0030, XEP-0297 |
| [XEP-0297](plugins/XEP0297/readme.md) | Stanza 转发 | XEP-0030, XEP-0203 |
| [XEP-0308](plugins/xep0308/readme.md) | 消息更正 | XEP-0030 |
| [XEP-0313](plugins/xep0313/readme.md) | 消息归档管理（MAM） | XEP-0004, XEP-0030 |
| [XEP-0333](plugins/xep0333/readme.md) | 已显示标记（Displayed Markers） | XEP-0030 |
| [XEP-0334](plugins/xep0334/readme.md) | 消息处理提示 | — |
| [XEP-0359](plugins/xep0359/readme.md) | 唯一且稳定的节 ID | XEP-0030 |
| [XEP-0363](plugins/xep0363/readme.md) | HTTP 文件上传 | XEP-0030 |
| [XEP-0368](plugins/xep0368/readme.md) | 直连 TLS 的 SRV 记录 | — |
| [XEP-0380](plugins/xep0380/readme.md) | 显式加密标记（EME） | XEP-0030 |
| [XEP-0402](plugins/xep0402/readme.md) | PEP 原生书签 | XEP-0030、XEP-0163、XEP-0060 |
| [XEP-0410](plugins/xep0410/readme.md) | MUC 自 Ping | XEP-0045, XEP-0199 |
| [XEP-0421](plugins/xep0421/readme.md) | 半匿名 MUC 的住户标识 | XEP-0030 |
| [XEP-0424](plugins/xep0424/readme.md) | 消息撤回 | XEP-0030 |
| [XEP-0425](plugins/xep0425/readme.md) | 审核消息撤回 | XEP-0030, XEP-0424 |
| [XEP-0428](plugins/xep0428/readme.md) | 回退标记（Fallback） | XEP-0030 |
| [XEP-0444](plugins/xep0444/readme.md) | 消息反应 | XEP-0030 |
| [XEP-0461](plugins/xep0461/readme.md) | 消息回复 | XEP-0030 |
| [XEP-0486](plugins/xep0486/readme.md) | MUC 房间头像 | —（复用 XEP-0054/XEP-0153 工具） |

### 工具类 / 独立模块（不自动注册）

| 模块 | 名称 | 说明 |
|------|------|------|
| [XEP-0054](plugins/xep0054/readme.md) | vCard-Temp（已废弃） | 静态解析方法，供其他插件复用 |
| [XEP-0059](plugins/xep0059/readme.md) | 结果集管理（RSM） | 静态构造/解析方法，供 MAM 等协议复用 |
| [XEP-0077](plugins/xep0077/readme.md) | 带内注册 | 独立 socket，手动实例化 |
| [XEP-0082](plugins/xep0082/readme.md) | 日期/时间格式化 | 静态工具函数 |
| [XEP-0106](plugins/xep0106/readme.md) | JID 转义 | 静态转义/反转义工具 |
| [XEP-0128](plugins/xep0128/readme.md) | 服务发现扩展 | 由 XEP-0030 内部调用 |
| [XEP-0153](plugins/xep0153/readme.md) | vCard 头像（遗留） | 静态方法，供 MUC 等兼容场景复用 |
| [XEP-0156](plugins/xep0156/readme.md) | 发现替代连接方式 | 静态端点解析，由 WebSocket 传输调用 |
| [XEP-0392](plugins/xep0392/readme.md) | 一致性颜色生成 | 静态方法，由字符串确定性生成颜色 |
| [XEP-0426](plugins/xep0426/readme.md) | 正文中的字符计数 | 静态码点计数与偏移换算，供 fallback 区间使用 |
