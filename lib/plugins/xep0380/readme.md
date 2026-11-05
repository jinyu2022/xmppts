# XEP-0380 — Explicit Message Encryption

用机器可读的元素标记消息使用的端到端加密机制，供不支持该机制的对端提示用户。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0380`
- **规范版本**：0.4.0（2021-11-18）

## 注册后行为

1. 向 disco#info 添加 `urn:xmpp:eme:0` 特性。
2. 注册 `<encryption/>` 解析器，结果写入 `message.eme`。

## 扩展字段

```typescript
interface Message {
  eme?: {
    namespace: string; // 加密机制的主命名空间
    name?: string;     // 机制的人类可读名称；已知机制的展示名请用 getMechanismName
  };
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0380.createEncryptionEl(info)`（静态） | 构造 `<encryption/>`；已知机制的 `name` 会被忽略 |
| `XEP0380.parseEncryptionEl(encryptionEl)`（静态） | 解析 `<encryption/>` |
| `XEP0380.getMechanismName(namespace)`（静态） | 返回规范列出的已知机制名称 |
| `XEP0380.KNOWN_MECHANISMS`（静态） | 已知机制表 |
| `XEP0380.NS`（静态） | `"urn:xmpp:eme:0"` |

## 使用示例

```typescript
// §3 Example 1：标记 OTR 加密消息
const msg = Message.createMessage("juliet@capulet.lit/balcony", encryptedBody);
msg.appendChild(XEP0380.createEncryptionEl({ namespace: "urn:xmpp:otr:0" }));
client.send(msg);

// 收到无法解密的消息时提示用户
client.on("message", (message) => {
  if (!message.eme) return;
  const name =
    XEP0380.getMechanismName(message.eme.namespace) ?? message.eme.name ?? message.eme.namespace;
  // 显示「本条消息使用 <name> 加密，无法解密」
});
```

## 注意事项

- `namespace` 属性是必需的；缺失时解析器记录警告并忽略标记，消息其余部分照常处理。
- 已知机制（OTR、Legacy OpenPGP、OpenPGP for XMPP、OMEMO 各版本）不应携带 `name`；`createEncryptionEl` 会忽略并记录警告，接收方也应优先使用自己已知的名称（§4）。
- 发送方可以不管对方是否宣告支持就直接附加（对方可能有多个能力不同的客户端，§4）。
- 规范要求无法解密时必须告知用户，并建议保留未加密正文以兼容旧客户端（§4）。
- 不要把本元素用于出席或 IQ：规范只覆盖消息（§2）。
