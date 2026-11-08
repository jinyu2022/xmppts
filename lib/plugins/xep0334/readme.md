# XEP-0334 — Message Processing Hints

在消息上附加路由提示，告知服务器与其他实体应如何处理这条消息。

- **依赖**：无
- **实例访问**：`connection.XEP0334`
- **规范版本**：1.0.0（2024-04-17）

## 注册后行为

1. 注册 `urn:xmpp:hints` 解析器，结果写入 `message.hints`（数组，每个提示元素各解析一次，合并到同一个数组）。

不宣告 disco 特性：规范未定义该特性的发现方式。

## 扩展字段

解析结果为数组，每个提示元素一项。对端可能同时给出语义冲突的组合，不在解析阶段拒绝。

```typescript
type MessageHint = "store" | "no-store" | "no-copy" | "no-permanent-store";

interface Message {
  hints?: MessageHint[];
}
```

取值就是元素本地名，读取时用 `includes`。同一提示重复出现时数组中会有重复项：规范不允许，但本项目不校验对端。

写入端使用 `HintsInput`：至少给出一个提示，存储类提示互斥，`no-copy` 可与任意存储提示组合；两种顺序等价，元素按传入顺序生成。

```typescript
type StoreHint = "store" | "no-store" | "no-permanent-store";
type HintsInput =
  | readonly [StoreHint]
  | readonly [StoreHint, "no-copy"]
  | readonly ["no-copy", StoreHint]
  | readonly ["no-copy"];
```

## 公开 API

| 成员 | 说明 |
|------|------|
| `XEP0334.applyHints(message, hints)`（静态） | 把提示附加到消息上，覆盖已有提示；`hints` 为 `null` 时只清除已有提示 |
| `XEP0334.createHintEls(hints)`（静态） | 按传入顺序构造提示元素数组，收 `readonly MessageHint[]`，未知提示与重复项丢弃并记 `warn` |
| `XEP0334.parseHintEl(hintEl)`（静态） | 解析单个提示元素，返回只含当前元素本地名的数组；命名空间不符抛 `Error`，未知提示原样保留 |
| `XEP0334.NS`（静态） | `"urn:xmpp:hints"` |

## 使用示例

```typescript
// 加密消息：不让服务器存档，也不复制到其他资源
const msg = Message.createMessage("juliet@capulet.lit/laptop");
XEP0334.applyHints(msg, ["no-store", "no-copy"]);
client.send(msg);

// 收到时读取
client.on("message", (message) => {
  if (message.hints?.includes("no-store")) {
    // 不要把这条消息写入历史记录
  }
});
```

## 注意事项

- 提示只是建议，规范明确实现不得依赖对端对提示的解释（§5）。
- `applyHints` 的第一个参数是消息元素（如 `Message.createMessage(...)` 的返回值）。
- `no-copy` 只能用于收件人为完整 JID 的消息；`applyHints` 对 bare JID 或未指定收件人的消息会抛错（§4）。
- `applyHints` 传 `null` 会清除消息上已有的全部提示（覆盖语义）。
- `applyHints` 的 `hints` 在类型上要求至少一个提示，且存储类提示互斥；`createHintEls` 不限，未知提示与重复项会被丢弃并记一条 `warn`。
- `parseHintEl` 一次只解析一个元素，值直接取自元素本地名，未知提示也会进数组，读取时用 `includes` 判断即可。多个提示由框架拼接，不要在 handler 里再扫兄弟节点。
- 规范建议忽略 `type="error"` 的消息中的提示（§5），本实现不区分节类型，错误回显的提示同样会解析出来，需要时由使用方按 `message.type` 过滤。
- XEP-0333 的群聊已读标记、XEP-0444 的 `store` 提示等场景需要同类元素时，可复用本插件的 `createHintEls` 生成；现有 XEP-0444 实现是自行创建 `<store/>`。
