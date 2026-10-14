# XMPP 核心登录流程 (RFC 6120)

本文档概述了 XMPP 客户端连接到服务器并建立会话的核心流程，主要基于 RFC 6120 (XMPP Core) 的规范。理解这些步骤对于实现传输层 `XMPPConnection` 与高层 `Connection` 逻辑至关重要。

整个流程是一个多阶段的**流协商 (Stream Negotiation)**过程，直到客户端完成认证和资源绑定，才能开始发送消息节（Stanza）。

## 0. 生命周期事件总览

下图为 ASCII 时序图，将传输层 `Socket`（WS/TCP）事件与高层 `Connection` 事件绘制在同一时间轴上。`Connection` 在 [`_setupSocketEvents()`](../connection.ts) 中订阅 socket 事件并转发为自身事件。

```text
  应用层                Connection              Socket (WS/TCP)            XMPP 服务器
    │                      │                        │                          │
    │  connect()           │                        │                          │
    ├─────────────────────►│                        │                          │
    │                      ├── connect(url)────────►│                          │
    │                      │                        ├── TCP/TLS/WS 握手 ──────►│
    │                      │                        │◄──────── 握手完成 ────────┤
    │                      │               socket: open                       │
    │◄───── conn: connect ─┼──────── 转发 ──────────│                          │
    │                      │                        ├── 流头部 ───────────────►│
    │                      │              socket: stream:start                │
    │                      │                        ├── <auth> SASL 认证 ─────►│
    │                      │                        │◄──────── <success> ──────┤
    │                      │            socket: authenticated                 │
    │                      │                        ├── 流重启 + 二次流特性 ────►│
    │                      │                        │◄─── <features><bind/> ────┤
    │                      │       pipeline: stream:negotiated                │
    │                      │                        ├── <iq set><bind/> ───────►│
    │                      │                        │◄─────── bound JID ────────┤
    │                      │               socket: binded                     │
    │◄─ conn: session:start┼──────── 转发 ──────────│                          │
    │                      │                        │                          │
    │    ═════ 活跃会话（循环）═════                  │                          │
    │                      │                        │◄──────── stanza ─────────┤
    │                      │               socket: stanza                     │
    │◄─ conn: message/iq/presence/others ── 转发 ───│                          │
    │                      │                        │                          │
    │    ═════ 关闭 ═════                              │                          │
    │                      │                        ├── </stream:stream> ─────►│
    │                      │              socket: stream:end（会话关闭）       │
    │◄── conn: session:end ┼──────── 转发 ──────────│                          │
    │                      │               socket: close（连接关闭）           │
    │◄──── conn: disconnect┼──────── 转发 ──────────│                          │
    │                      │                        │                          │
    │    ═════ 异常路径 ═════                        │                          │
    │                      │       socket: error（认证失败 / 绑定超时 / WS 错误） │
```

> 事件归属速查：**socket** 事件为 `open` / `authenticated` / `stream:start` / `binded` / `stanza` / `stream:end` / `close` / `error`（`stream:negotiated` 属管线事件点，见 `TransportPipelineEvents`）；**connection** 事件为 `connect` / `session:start` / `session:end` / `connection:lost` / `reconnecting` / `reconnected` / `disconnect` / `message` / `iq` / `presence` / `others`。两层命名零重叠：`open → connect`、`binded → session:start`、`stream:end → session:end`、`close → disconnect`。会话关闭（`stream:end`）与连接关闭（`close`）是两个独立事件。

## 1. 网络连接 (TCP Binding)

这是建立 XMPP 会话的第一步，涉及底层网络连接。

*   **客户端动作:**
    1.  **DNS 解析 FQDN** (Section 3.2): 解析服务器的完全限定域名（FQDN）以获取 IP 地址和端口。
    2.  **建立 TCP 连接** (Section 3.1): 通过解析得到的地址和端口建立持久的 TCP 连接。
*   **对应代码:** [connect()](tcp.ts#L183)（SRV 解析 L211-L224）、[setupSocketListeners()](tcp.ts#L270)

## 2. 流建立 (Stream Establishment)

在 TCP 连接建立后，客户端和服务器通过交换 XML 流头部来启动 XMPP 流。

*   **客户端动作 (C:):**
    *   **发送初始流头部** (Section 4.2):
    ```xml
    <?xml version='1.0'?>
    <stream:stream 
        xmlns="jabber:client" 
        version="1.0" 
        xmlns:stream="http://etherx.jabber.org/streams" 
        to="im.example.com" 
        xml:lang="zh-CN"
    >
    ```
*   **服务器动作 (S:):**
    *   **响应流头部** (包含 Stream ID):
    ```xml
    <?xml version='1.0'?>
    <stream:stream
        from='im.example.com'
        id='t7AMCin9zjMNwQKDnplntZPIDEI='
        to='juliet@im.example.com'
        version='1.0'
        xml:lang='en'
        xmlns='jabber:client'
        xmlns:stream='http://etherx.jabber.org/streams'>
    ```
*   **对应代码:** [openStream()](tcp.ts#L397)、[sendStreamHeader()](tcp.ts#L590)

## 3. 流协商：传输层安全 (TLS Negotiation)

客户端和服务器协商是否使用 TLS 来加密连接。

*   **服务器动作 (S:):**
    *   **发送流特性** (包含 `<starttls/>`):
    ```xml
    <stream:features>
        <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'>
            <required/>
        </starttls>
    </stream:features>
    ```
*   **客户端动作 (C:):**
    *   **发送 `<starttls/>` 命令** (Section 5.4.2.1):
    ```xml
    <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
    ```
*   **服务器动作 (S:):**
    *   **响应 `<proceed/>`:**
    ```xml
    <proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
    ```
    *   **执行 TLS 握手** (Section 5.4.3): 客户端和服务器在底层 TCP 连接上执行 TLS 握手。
*   **对应代码:** [onFeaturesStartTls()](tcp.ts#L405)、[onStartTls()](tcp.ts#L464)、[upgradeToTLS()](tcp.ts#L621)

## 4. 流重启 (Post-TLS Stream Restart)

TLS 握手成功后，必须重启 XML 流以清除旧的流上下文，并在加密通道上继续协商。

*   **客户端动作 (C:):**
    *   **发送新的流头部** (Section 5.4.3.3):
    ```xml
    <?xml version='1.0'?>
    <stream:stream
        from='juliet@im.example.com'
        to='im.example.com'
        version='1.0'
        xml:lang='en'
        xmlns='jabber:client'
        xmlns:stream='http://etherx.jabber.org/streams'>
    ```
*   **服务器动作 (S:):**
    *   **响应新的流头部** (新的 Stream ID):
    ```xml
    <?xml version='1.0'?>
    <stream:stream
        from='im.example.com'
        id='vgKi/bkYME8OAj4rlXMkpucAqe4='
        to='juliet@im.example.com'
        version='1.0'
        xml:lang='en'
        xmlns='jabber:client'
        xmlns:stream='http://etherx.jabber.org/streams'>
    ```
*   **对应代码:** [upgradeToTLS()](tcp.ts#L621) 内 `secureConnect`（L634-L636）→ [sendStreamHeader()](tcp.ts#L590)

## 5. 流协商：认证 (SASL Negotiation)

在安全通道上，客户端使用 SASL (Simple Authentication and Security Layer) 机制进行身份认证。

*   **服务器动作 (S:):**
    *   **发送流特性** (包含 `<mechanisms/>`):
    ```xml
    <stream:features>
        <mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
            <mechanism>PLAIN</mechanism>
            <mechanism>SCRAM-SHA-1-PLUS</mechanism>
            <mechanism>SCRAM-SHA-1</mechanism>
            <mechanism>X-OAUTH2</mechanism>
        </mechanisms>
        <sasl-channel-binding xmlns="urn:xmpp:sasl-cb:0">
            <channel-binding type="tls-exporter" />
            <channel-binding type="tls-server-end-point" />
        </sasl-channel-binding>
        <register xmlns="http://jabber.org/features/iq-register" />
    </stream:features>
    ```
*   **客户端动作 (C:):**
    *   **选择机制并认证** (以 SCRAM-SHA-1 为例，包含初始响应):
    ```xml
    <auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl"
        mechanism="SCRAM-SHA-1">
        biwsbj1qdWxpZXQscj1vTXNUQUF3QUFBQU1BQUFBTlAwVEFBQUFBQUJQVTBBQQ==
    </auth>
    ```
*   **服务器动作 (S:):**
    *   **挑战** (如果需要):
    ```xml
    <challenge xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
        cj1vTXNUQUF3QUFBQU1BQUFBTlAwVEFBQUFBQUJQVTBBQWUxMjQ2OTViLTY5Y
        ...
    </challenge>
    ```
*   **客户端动作 (C:):**
    *   **响应挑战:**
    ```xml
    <response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
        Yz1iaXdzLHI9b01zVEFBd0FBQUFNQUFBQU5QMFRBQUFBQUFCUFUwQUFlMTI0N
        ...
    </response>
    ```
*   **服务器动作 (S:):**
    *   **认证成功:**
    ```xml
    <success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
        dj1wTk5ERlZFUXh1WHhDb1NFaVc4R0VaKzFSU289
    </success>
    ```
    *   **或者 认证失败 (分支):**
    ```xml
    <failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
        <not-authorized/>
    </failure>
    ```
*   **客户端动作 (C:) (如果失败):**
    *   **当前实现不重试**：`<failure/>` 会抛 `SaslError`，由 `handleFailure()` 置 `Status.AUTHFAIL`、发出 `error` 事件并断开（[tcp.ts#L322-L329](tcp.ts#L322-L329)）。需要重试时重新 `connect()`。
    ```xml
    <auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>...</auth>
    ```
*   **对应代码:** [onSasl()](tcp.ts#L457)（success → `emit("authenticated")` L466 + 流重启 L467；失败 → [handleFailure()](tcp.ts#L322)）

## 6. 流重启 (Post-SASL Stream Restart)

SASL 认证成功后，必须再次重启 XML 流以清除旧的流上下文，并在认证后的通道上继续协商。

*   **客户端动作 (C:):**
    *   **发送新的流头部** (Section 6.4.6):
    ```xml
    <stream:stream
        from='juliet@im.example.com'
        to='im.example.com'
        version='1.0'
        xml:lang='en'
        xmlns='jabber:client'
        xmlns:stream='http://etherx.jabber.org/streams'>
    ```
*   **服务器动作 (S:):**
    *   **响应新的流头部** (新的 Stream ID):
    ```xml
    <stream:stream
        from='im.example.com'
        id='gPybzaOzBmaADgxKXu9UClbprp0='
        to='juliet@im.example.com'
        version='1.0'
        xml:lang='en'
        xmlns='jabber:client'
        xmlns:stream='http://etherx.jabber.org/streams'>
    ```
*   **对应代码:** [onSasl()](tcp.ts#L457) 内 success → [sendStreamHeader()](tcp.ts#L571)

## 7. 资源绑定 (Resource Binding)

客户端将一个唯一的资源标识符绑定到其裸 JID (`user@domain`)，以形成完整的 JID (`user@domain/resource`)。

*   **服务器动作 (S:):**
    *   **发送流特性** (包含 `<bind/>`):
    ```xml
    <stream:features>
        <bind xmlns="urn:ietf:params:xml:ns:xmpp-bind" />
        <session xmlns="urn:ietf:params:xml:ns:xmpp-session">
            <optional />
        </session>
        <c ver="qgDV6mKelsyqnn+KAHDtwHKe69A=" node="https://www.process-one.net/ejabberd/" hash="sha-1" xmlns="http://jabber.org/protocol/caps" />
        <sm xmlns="urn:xmpp:sm:2" />
        <sm xmlns="urn:xmpp:sm:3" />
        <sub xmlns="urn:xmpp:features:pre-approval" />
        <ver xmlns="urn:xmpp:features:rosterver" />
        <csi xmlns="urn:xmpp:csi:0" />
    </stream:features>
    ```
*   **客户端动作 (C:):**
    *   **发送 IQ set 绑定资源** (Section 7.7.1):
    ```xml
    <iq id='yhc13a95' type='set'>
        <bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>
            <resource>balcony</resource>
        </bind>
    </iq>
    ```
*   **服务器动作 (S:):**
    *   **响应 IQ result** (包含完整 JID):
    ```xml
    <iq id='yhc13a95' type='result'>
        <bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>
            <jid>juliet@im.example.com/balcony</jid>
        </bind>
    </iq>
    ```
*   **对应代码:** [onNegotiated()](tcp.ts#L475) 预填并发送绑定请求（记录 `bindId`，L492-L501）→ 绑定响应经 [onBinding()](tcp.ts#L515) 处理（[route()](tcp.ts#L332) 的 `BINDING` 分支）；[startBind()](tcp.ts#L542) 供插件回退重绑（如 XEP-0198 恢复被拒）

## 8. 会话建立 (Session Establishment)

在资源绑定之后，客户端被认为已登录。RFC 6120 起不再要求独立的会话建立步骤（RFC 3921 的 `<iq type='set'><session/></iq>` 已废弃，个别老服务器仍会宣告 `urn:ietf:params:xml:ns:xmpp-session`）。

*   **客户端动作 (C:):** 无——绑定成功后本库直接触发 `session:start`（见 [Connection._setupSocketEvents()](../connection.ts#L414)）。
*   **对应代码:** 如需向老服务器补发 `<session/>`，可自行用 [sendAsync()](../connection.ts#L744) 实现。

## 9. 节交换 (Stanza Exchange)

会话建立完成后，客户端可以开始发送和接收 XMPP 节（Stanza）。

*   **客户端动作 (C:):**
    *   **发送节** (例如 Message):
    ```xml
    <message from='juliet@im.example.com/balcony'
             to='romeo@example.net'
             xml:lang='en'>
        <body>Art thou not Romeo, and a Montague?</body>
    </message>
    ```
*   **服务器动作 (S:):**
    *   **接收并路由/投递节。**
*   **对应代码:** 发送 [Connection.send()](../connection.ts#L682)；接收 [route()](tcp.ts#L351) 分发 → `stanza` 事件 → [Connection 转发](../connection.ts#L439)

## 10. 流关闭 (Stream Closure)

当客户端或服务器希望终止会话时，会执行流关闭握手。

*   **客户端动作 (C:):**
    *   **发送流关闭标签** (Section 4.4):
    ```xml
    </stream:stream>
    ```
*   **服务器动作 (S:):**
    *   **响应流关闭标签** 并关闭 TCP 连接:
    ```xml
    </stream:stream>
    ```
*   **对应代码:** [disconnect()](tcp.ts#L676)（发 `</stream:stream>` L685）、[close()](tcp.ts#L698)

### 关键概念和实现要点

1.  **流重启 (Stream Restart):**
    *   在 **TLS 成功**和 **SASL 成功**后，客户端和服务器都必须发送一个新的 `<stream:stream>` 头部，以清除旧的流上下文，并在新的安全/认证通道上继续协商。
    *   底层 TCP 连接保持不变。
    *   服务器必须为新的流生成一个新的 `id` 属性。

2.  **流特性 (Stream Features):**
    *   服务器通过 `<stream:features>` 元素告知客户端当前阶段可以协商的特性（例如，TLS、SASL 机制、资源绑定）。
    *   客户端必须按顺序协商这些特性：**TLS (加密) -> SASL (认证) -> 资源绑定 (地址)**。

3.  **资源绑定 (Resource Binding):**
    *   这是客户端登录的最后一步，通过 IQ 节完成。
    *   成功后，客户端获得完整的 JID (`user@domain/resource`)，并被允许发送消息节。

4.  **错误处理:**
    *   **流错误 (Stream Error):** 发生在流协商阶段，会导致流关闭和 TCP 连接终止（例如 `<not-authorized/>`, `<host-unknown/>`）。
    *   **节错误 (Stanza Error):** 发生在节交换阶段，通过 IQ、Message 或 Presence 节的 `type='error'` 属性返回（例如 `<conflict/>`, `<bad-request/>`）。


