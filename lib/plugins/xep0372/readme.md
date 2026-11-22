# XEP-0372 — References

在消息正文中标注引用区间，常用于 @提及（`type="mention"`）与数据引用。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0372`
- **规范版本**：0.5.0（2020-12-09）

## 注册后行为

1. 向 XEP-0030 添加 `urn:xmpp:reference:0` 特性。
2. 注册 `<reference/>` 解析器，每个引用元素各解析一次，结果拼接到 `message.references` 数组。

不注册专用事件，在 `message` 事件中读取 `message.references` 即可。

## 扩展字段

```typescript
interface MessageReference {
  type: string;     // 如 "mention"、"data"
  uri: string;      // 被引用对象的 URI
  begin?: number;   // 正文中的起始码点（含）
  end?: number;     // 正文中的结束码点（不含）
  anchor?: string;  // 指向被标注原消息的 URI（§3.4）
}

interface Message {
  references?: MessageReference[];
}
```

## 公开 API

| 方法 | 说明 |
|------|------|
| `sendReferences(to, body, references, type)` | 发送只含正文与引用的消息；引用带 `anchor` 时不得生成 `<body/>`（`undefined` 与空串均不生成，§3.4） |
| `XEP0372.createReferenceEl(reference)`（静态） | 创建单个 `<reference/>` |
| `XEP0372.appendReferences(message, references)`（静态） | 把引用附加到已经组好的消息上（可用于回复、带 OOB 等消息），返回同一个消息 |
| `XEP0372.appendTextReference(message, text, reference)`（静态） | 在消息正文中定位 `text` 并附加引用，区间自动换算为码点（XEP-0426） |
| `XEP0372.NS`（静态） | `"urn:xmpp:reference:0"` |

## 使用示例

```typescript
// 已知码点区间时直接给
client.XEP0372!.sendReferences(
  "coven@chat.shakespeare.lit",
  "你好 romeo",
  [{ type: "mention", uri: "xmpp:romeo@montague.lit", begin: 3, end: 8 }],
  "groupchat",
);

// 不知道区间：给消息与被引用的文本，自动定位并换算码点
const msg = Message.createMessage(room, "😀 @romeo 看一下", "groupchat");
client.XEP0372!.appendTextReference(msg, "@romeo", {
  type: "mention",
  uri: "xmpp:romeo@montague.lit",
});
client.send(msg);

// 消息已带其它扩展（例如回复）时同样适用
const replyMsg = XEP0461.createReplyMessage(to, replyEl, body, "groupchat");
client.XEP0372!.appendTextReference(replyMsg, "@romeo", {
  type: "mention",
  uri: "xmpp:romeo@montague.lit",
});
client.send(replyMsg);

// 收到时读取
client.on("message", (message) => {
  for (const ref of message.references ?? []) {
    if (ref.type === "mention") console.log("提到了", ref.uri);
  }
});
```

## 注意事项

- `begin`/`end` 按 Unicode 码点计数，`begin` 包含、`end` 不包含（§3）。需要自行给出区间时用 XEP-0426 换算：`XEP0426.toCodePointOffset(text, utf16Index)` / `XEP0426.length(text)`，不要用 `String.length`。
- 引用不是正文子串时不要携带 `begin`/`end`；带 `anchor` 时 `begin`/`end` 指**原消息**正文中的位置（§3.4 示例）。
- 用 `anchor` 标注历史消息时，当前消息不得包含 `<body/>`（§3.4）；`appendReferences` 与 `sendReferences` 会在附加前检查实际消息，发现正文即抛错。
- `begin`/`end` 必须是十进制非负整数、`begin <= end` 且成对出现（§3.2：引用不是正文子串时两者都不使用），生成阶段会校验；解析时无法识别的偏移按缺失处理。
- 缺少 `type` 或 `uri` 的 `<reference/>` 会被忽略并记录警告，不影响同一消息的其他引用与正文；全部引用都无效时 `message.references` 为 `undefined`。
- `appendTextReference` 按「正文 + 被引用文本」定位，正文中多次出现时取第一处；找不到或消息没有正文直接抛错，不会静默省略区间。它只适用于引用当前消息正文的情况，`anchor` 场景请用 `appendReferences` 自行给区间。
- 消息有多份带 `xml:lang` 的 `<body/>` 时，`appendTextReference` 只按首个 `<body/>` 定位（与 `message.body` 一致）；规范未定义这种消息里 `begin`/`end` 属于哪份正文。
- 一条消息可以有多个引用；`parseReferenceEl` 一次只解析一个元素，由框架按调用顺序拼接，不要在 handler 里再扫兄弟节点。
