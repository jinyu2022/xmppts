# lib — XMPP 客户端库核心

面向浏览器与 Node.js 的 XMPP 协议库核心；扩展协议以插件形式实现。

## 目录结构

| 路径 | 说明 |
|------|------|
| `main.ts` | 包入口（导出 `Client`） |
| `client.ts` | `Client` 类（继承 `Connection`，含便捷方法） |
| `connection.ts` | 核心：插件注册 / 拦截器 / Stanza 路由 / `sendAsync` |
| `stanza.ts` | `StanzaBase` / `Iq` / `Message` / `Presence` |
| `JID.ts` / `errors.ts` / `dns.ts` / `log.ts` / `types.ts` | JID、错误、DNS、日志、公共类型 |
| `ltx/` | XML 解析引擎（`Parser` / `LtxParser` / `XMPPElement`） |
| `transport/` | 传输层（TCP/TLS 管线、流协商），见 [transport/README.md](transport/README.md) |
| `auth/` | SASL/SCRAM 辅助（如 base64 工具） |
| `plugins/` | 插件实现（见下） |

> 连接生命周期与状态机见 [LIFECYCLE.md](LIFECYCLE.md)。

## 发送时机与失败行为

插件 `init()` 只注册处理器与本地状态；业务请求应在 `session:start` 后发送。
`send()` 在未连接、已断开时抛出 `Error`，`message` / `iq` / `presence` 在会话未就绪（包括协商与自动重连期间）也抛错。检查在发送管线入口执行，初始化或清理导致管线没有写出终端时也不会静默丢弃。
流层元素仍可在传输可用的协商阶段发送。会话就绪后的插件拦截器可以通过不调用 `next()` 主动短路。
`sendAsync()` 通过请求表按 id 匹配响应；发送失败、超时或连接断开都会 reject；结束等待时统一停掉超时计时器并清除表项；它不会等待会话或自动排队。

## 地址与命名空间

- [JID](JID.ts#L12) 的 `full` 在有 resource 时返回 `bare/resource`，无 resource 时返回 `bare`，不会追加空 `/`。
- [XMPPElement](ltx/Element.ts#L79) 的 `namespaceURI` 在显式 `xmlns=""` 下返回 `null`，后代同样不继承外层默认命名空间；前缀绑定及子元素重新声明的命名空间不受影响。

## XML 属性与字符引用

- [LtxParser](ltx/LtxParser.ts#L60) 的 `startElement` 事件使用无原型属性表，`__proto__`、`constructor` 等名称按普通属性保留，解析与序列化往返不会丢失。
- [数字字符引用](ltx/escape.ts#L35) 支持十进制 `&#65;` 和十六进制 `&#x41;`，允许前导零及大小写十六进制数字，十六进制前缀必须为小写 `x`。带尾缀、正负号或空白的写法（如 `&#65junk;`、`&#+65;`）会抛出 `Error`；码点范围按 [XML 1.0 §2.2、§4.1](https://www.w3.org/TR/xml/#sec-references) 校验。
- 这不是完整 XML 校验：裸 `&`、缺少分号、重复属性等仍有缺口；实体错误可能直接从 `write()` / `end()` 同步抛出，不能只依赖 `error` 事件。未解决问题及输入示例见 [ltx/debug.md](ltx/debug.md)。

## 已实现的协议

### 插件（登记在 `pluginLoaders`，可自动注册）

| 插件 | 名称 | 依赖 |
|------|------|------|
| [RFC6121](plugins/rfc6121/readme.md) | 即时消息与存在（花名册） | — |
| [XEP-0004](plugins/xep0004/readme.md) | 数据表单 | — |
| [XEP-0030](plugins/xep0030/readme.md) | 服务发现 | — |
| [XEP-0045](plugins/xep0045/readme.md) | 多用户聊天（MUC） | XEP-0030 |
| [XEP-0060](plugins/xep0060/readme.md) | 发布-订阅（PubSub，仅注册 `pubsub#errors` 解析器） | — |
| [XEP-0084](plugins/xep0084/readme.md) | 用户头像 | XEP-0030、XEP-0163（PEP，见该目录 debug S2） |
| [XEP-0115](plugins/xep0115/readme.md) | 实体能力 | XEP-0030 |
| [XEP-0163](plugins/xep0163/readme.md) | 个人事件协议（PEP） | XEP-0030 |
| [XEP-0172](plugins/xep0172/readme.md) | 用户昵称 | XEP-0030 |
| [XEP-0184](plugins/xep0184/readme.md) | 消息回执 | — |
| [XEP-0198](plugins/xep0198/readme.md) | 流管理 | — |
| [XEP-0199](plugins/xep0199/readme.md) | XMPP Ping | XEP-0030 |
| [XEP-0203](plugins/xep0203/readme.md) | 延迟投递 | — |
| [XEP-0280](plugins/xep0280/readme.md) | 消息碳副本 | XEP-0030, XEP-0297 |
| [XEP-0297](plugins/XEP0297/readme.md) | 节转发 | XEP-0030, XEP-0203 |
| [XEP-0308](plugins/xep0308/readme.md) | 消息更正 | XEP-0030 |
| [XEP-0359](plugins/xep0359/readme.md) | 唯一且稳定的节 ID | XEP-0030 |
| [XEP-0368](plugins/xep0368/readme.md) | 直连 TLS 的 SRV 记录 | — |
| [XEP-0402](plugins/xep0402/readme.md) | PEP 原生书签 | XEP-0030, XEP-0163 |
| [XEP-0410](plugins/xep0410/readme.md) | MUC 自 Ping | XEP-0045, XEP-0199 |
| [XEP-0424](plugins/xep0424/readme.md) | 消息撤回 | XEP-0030 |
| [XEP-0425](plugins/xep0425/readme.md) | 审核消息撤回 | XEP-0030, XEP-0424 |
| [XEP-0486](plugins/xep0486/readme.md) | MUC 房间头像 | XEP-0054/XEP-0153 |

### 工具类 / 独立模块（不自动注册）

| 模块 | 名称 | 说明 |
|------|------|------|
| [XEP-0054](plugins/xep0054/readme.md) | vCard-Temp（已废弃） | 静态解析方法，供其他插件复用 |
| [XEP-0077](plugins/xep0077/readme.md) | 带内注册 | 独立 socket，手动实例化 |
| [XEP-0082](plugins/xep0082/readme.md) | 日期/时间格式化 | 静态工具函数 |
| [XEP-0106](plugins/xep0106/readme.md) | JID 转义 | 静态转义/反转义工具 |
| [XEP-0128](plugins/xep0128/readme.md) | 服务发现扩展 | 由 XEP-0030 内部调用 |
| [XEP-0153](plugins/xep0153/readme.md) | vCard 头像（遗留） | 静态方法，供 MUC 等兼容场景复用 |
| [XEP-0156](plugins/xep0156/readme.md) | 发现替代连接方式 | 静态端点解析，由 WebSocket 传输调用 |
| [XEP-0392](plugins/xep0392/readme.md) | 一致性颜色生成 | 静态方法，由字符串确定性生成颜色 |
