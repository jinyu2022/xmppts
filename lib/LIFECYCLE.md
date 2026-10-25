# XMPPTS 库生命周期说明文档

本文档详细说明了 `xmppts` 库的连接生命周期、状态机转换、插件系统以及数据流转机制。

## 1. 核心组件架构

- **`Connection` (lib/connection.ts)**: **会话层**的核心类，负责插件生命周期管理、Stanza 解析与分发、拦截器管线以及异步请求的 Promise 映射。
- **`StreamConnection` (lib/transport/stream-connection.ts)**: **连接层（传输层）**的流协商基类，负责状态机、SASL 认证、资源绑定、会话恢复与管线事件。
- **传输注册表 (lib/transport/index.ts)**: 维护协议到 `TransportFactory` 的映射；`Connection` 按 `protocol` 从 `transports` 取值，新增协议无需修改连接类。
- **`XMPPConnection` (lib/transport/tcp.ts)**: TCP/STARTTLS 传输实现，负责 DNS SRV 解析、socket 生命周期、RFC 6120 流头/流尾与 TLS 升级。
- **`WSConnection` (lib/transport/websocket.ts)**: WebSocket（RFC 7395）传输实现，复用基类的认证/绑定流程。
- **`Status` (lib/transport/typing.ts)**: 定义了连接过程中的所有状态常量。

### 1.1 层与命名

| 称呼 | 代码位置 | 职责 |
| :--- | :--- | :--- |
| 连接层 / 传输层 | `lib/transport/`（`StreamConnection` 及 `tcp.ts` / `websocket.ts` / `tcp-direct.ts`） | socket、TLS、SASL、资源绑定、流协商；只通过 `TransportSink` 的 `onBinded` / `onStanza` / `onClose` / `onError` 向上汇报 |
| 会话层 / 高层（conn 层） | `lib/connection.ts` 的 `Connection` | 插件生命周期、stanza 路由、`sendAsync`、`session:*` 事件、自动重连策略 |

> 类名易混：`Connection` 指会话层，`StreamConnection` 才是连接层。本文档中的「conn 事件」「高层事件」均指 `Connection` 上的事件；「传输层通知」指 `TransportSink` 回调。

## 2. 详细生命周期阶段

### 2.1 配置与注册阶段 (Pre-connection)
在调用 `connect()` 之前，程序处于静态配置阶段：
1.  **构造实例**: `new Connection(jid, password, options)`。解析 JID，记录端点配置（`host`/`port`/`path`/`protocol`/`tls`）。
2.  **插件注册 (`registerPlugin`)**: 插件构造函数被添加到 `pendingPlugins` 待处理队列。此时插件尚未实例化。

### 2.2 初始化与注入阶段 (Initialization)
当调用 `async connect()` 时，但在网络握手之前：
1.  **插件依赖解析 (`checkAndRegisterDep`)**: 递归扫描插件的静态 `dependencies` 属性，自动注册缺失的依赖插件。
2.  **插件实例化**: 执行 `new Plugin(connection)`。构造函数早于传输创建，可注册或覆盖传输实现（`connection.registerTransport`），但不得访问传输层管线。需要网络发现的选择（如 XEP-0368 的直连 TLS）放在工厂的 `create()` 内完成；XEP-0156 是纯静态工具，由 WebSocket 传输在 `openTransport()` 内按需调用。

    **覆盖顺序**：插件实例化发生在 `connect()` 内部，晚于用户调用 `registerTransport()`，所以同名协议的插件注册会覆盖用户注册（XEP-0368 覆盖 `xmpp` 正是依赖这一点）。用户自定义实现需要生效时，不要注册会覆盖该协议的插件，或改用其他协议名。
3.  **创建传输**: 连接层按 `protocol` 从 `transports` 映射取值并调用工厂。工厂的 `create()` 可异步（如 DNS SRV / host-meta 查询），并可返回不同的传输实例；用户显式指定的 `host`/`port` 必须同时提供才会被采纳，否则视为未指定，由传输层自行发现。
4.  **`init()` 调用**: 调用每个插件实例的 `init()` 方法；此时 `connection.transport` 已就绪，可注册管线与事件处理器。
5.  **插件扩展能力注入**: 插件通常在 `init()` 中通过以下接口扩展功能：
    *   `registerStanzaPlugin()`: 注册 XML 命名空间到 JS 对象的映射器。
    *   `connection.pipeline.use()`: 插入 `send`/`receive` 拦截管线。
    *   `registerEventPlugin()`: 定义基于 Stanza 内容匹配的自定义事件。

### 2.3 底层流协商阶段 (Negotiation)
底层状态机（`XMPPConnection`）的流转过程：
1.  **`Status.CONNECTING` (1)**: 发起 TCP 握手。
2.  **`Status.CONNECTED` (2)**: TCP 建立，发送第一个 XML 流起始标签。
3.  **`Status.STREAM_START` (3)**: 已发送流头，等待服务器返回特性。
4.  **`Status.STREAM_ESTABLISHED` (4)**: 收到特性列表。
5.  **SASL 认证 (`Status.AUTHENTICATING` -> `AUTHENTICATED`)**: 自动处理认证往返。认证成功后，底层会自动**重启流**并发送第二次流头。
6.  **资源绑定 (`Status.BINDING` -> `BINDED`)**: 绑定后分配 Full JID。
7.  **触发通知**: 底层通过 `TransportSink` 通知高层：`onBinded` -> 高层 `session:start`（重连成功为 `reconnected`）；`onClose` -> 高层按重连策略处理（`session:end` 或重连）；`onError` -> 高层 `error` 事件；`onStanza` -> 业务分发。

> `connect()` 在开始拨号后即 resolve；认证/绑定结果通过事件通知（成功 `session:start`，失败 `error`），不会以 reject 表示。只有传输创建/拨号阶段抛出的错误才会同时 `emit("error")` 并 reject。

### 2.4 活跃会话阶段 (Active Session)
连接建立后，处理 Stanza 的收发流转。

#### 发送管线 (Send Pipeline)
1.  **`send(stanza)`**: 校验必备属性（message 需 `to`、iq 需 `type`，groupchat 的 `to` 归一化为 bare JID），补全 `id` / `xmlns`，执行 `send` 拦截器链，最后由管线的写出终端交给传输层。写出终端由连接层在构造时用 `pipeline.terminal()` 注册，固定在全部插件之后，`pipeline.clear()` 不会清除它；插件在 `next()` 返回后即可确认 stanza 已写出。
2.  **`sendAsync(stanza)`**: 自动生成 ID 并登记到请求表（按 id 匹配），设 30s 超时定时器，返回 Promise；响应到达、超时、发送失败或断开都走同一个收尾函数（停计时器、删表项、settle）。

#### 接收管线 (Receive Pipeline)
1.  **底层**: Parser 解析出完整 XML Tree，传输层调用 `TransportSink.onStanza` 交给高层。
2.  **拦截器**: 执行 `receive` 拦截器链。
3.  **转换器 (`transformExtensions`)**: 扫描直接子元素与构造期字段中的元素，将匹配 `StanzaPlugin` 的 XML 节点转换为结构化 JS 对象并合并到实例上。
4.  **请求兑现**: 节的 id 命中请求表时，结束对应的 `sendAsync` Promise。
5.  **分发**: 发出 `message`, `iq`, `presence` 等具体事件。

### 2.5 终止阶段 (Termination)
调用 `connection.disconnect()` 时：
1.  **终结会话**: `finishSession()` 先把 `isSessionActive` 降为 `false`、再派发 `session:end`（监听器内不能继续发送业务 stanza），最后 `_cleanup()` 清理并把 `transport` 置空——后续 `close` 据此判断本次连接已终结，不再调度重连。
2.  **断开连接**: `transport.disconnect()` 向服务器发送 `</stream:stream>`，状态置为 `SESSIONEND`，随后关闭底层连接；此时 `close` 不再产生高层事件。
3.  **错误上报**: 认证失败、协商/流错误等通过 `error` 事件上报，载荷为 `ProtocolError`，用 `scope`（`sasl` / `binding` / `stream` / `protocol`）区分来源；会话从未建立时只发 `error`，不发 `session:end`（与 `session:start` 配对）。
4.  **高层清理**: 终结会话时（主动断开、不可重试错误、重连耗尽）执行 `_cleanup()`：`removeAllListeners()` 移除所有监听器，并清空拦截器与插件注册表；`pendingPlugins` 保留，再次 `connect()` 时由 `instantiatePlugins()`/`initPlugins()` 重建插件。

**自动重连条件**：启用自动重连且连续失败次数未达上限（绑定成功即清零）。**套接字已建立后**的网络类断开（含首连尚未完成绑定、无错误的 clean close）会重试；`ProtocolError`（SASL/绑定/流/协议错误）在 `onError` 时直接终结会话，不进入重连，以免重复提交无效凭据；例外是 `retryable` 为 `true` 的临时错误（协商/连接超时、`system-shutdown`），交给随后的 `onClose` 判断是否重连。**建套接字前**的失败（DNS/SRV、XEP-0368/0156 发现、传输工厂 `create` 抛错）没有 close 事件，`connect()` 只 reject 并发出 `error`，本次不调度重连。

## 3. 核心事件汇总表

事件按层次分为两类：**传输层通知**（`lib/transport/*` 通过 `TransportSink` 回调，单向、单消费者）描述传输与协商事实，**conn 事件**（`lib/connection.ts`）表达会话级语义，二者命名刻意不重叠。

### 传输层通知（`TransportSink`）

| 回调 | 触发时机 | 高层处理 |
| :--- | :--- | :--- |
| `onBinded` | 资源绑定成功，分配 Full JID | 每个 `connect()` 周期的首次绑定发 `session:start`，之后（自动重连）发 `reconnected` |
| `onStanza` | 协商完成后收到完整 XML 节 | 接收管线 → 事件分发 |
| `onClose` | 物理连接关闭（传输层已置 `DISCONNECTED`） | 会话未终结且可重连时调度重连，否则发出 `session:end` |
| `onError` | 认证失败/协商错误/超时/底层错误 | 立即以 `error` 事件上报；`ProtocolError` 同时终结会话（不重连），`retryable` 的临时错误（超时、`system-shutdown`）例外，交给随后的 `onClose` 判断 |

> 另有**管线事件点**（非 `TransportSink` 通知）：`stream:features:starttls` / `starttls:proceed` / `stream:features:mechanisms` / `sasl` / `stream:negotiated` / `binding`，由 `pipeline.run()` 在各协商阶段触发，载荷类型见 `TransportPipelineEvents`。

### Conn 事件（高层）

| 事件名称 | 触发时机 | 典型用途 |
| :--- | :--- | :--- |
| `session:start` | 每个 `connect()` 周期的首次资源绑定成功，会话完全就绪 | **业务入口**，在此发送在线状态 |
| `session:end` | 会话结束且不再重连（主动断开、对端关闭、协商失败或重连耗尽） | 清理会话资源 |
| `error` | 连接错误（网络失败、`ProtocolError` 等；后者用 `scope` 区分为 `sasl` / `binding` / `stream` / `protocol`） | 提示失败原因；会话可能尚未建立 |
| `connection:lost` | 已建立会话的网络断线，进入自动重连（同一次断线只发一次） | 提示不可用的断线 |
| `reconnecting` | 每次自动重连尝试前 | 重连进度提示 |
| `reconnected` | 自动重连成功（会话此前已建立，不再发 `session:start`） | 会话恢复后同步状态 |
| `message/iq/presence/others` | 经过解析和插件转换后的业务数据 | 处理聊天消息、回复请求 |

## 4. 错误处理

- **`DOMException`（name 为 `TimeoutError`）**: `sendAsync` 请求在规定时间内未收到响应。
- **`ProtocolError`**: 传输层的认证/绑定/流/协商错误，`scope` 为 `sasl` / `binding` / `stream` / `protocol`；`retryable: true` 表示临时错误（如协商/连接超时），上层可按网络断开处理并重连。
- **`XMPPError`**: 业务层错误（如 IQ 错误响应）。
- **`Status.AUTHFAIL`**: SASL 认证失败，将直接触发断开连接。

