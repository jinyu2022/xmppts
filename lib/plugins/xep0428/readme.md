# XEP-0428 — Fallback Indication

标记消息正文或主题中仅供旧客户端显示的回退内容。

- **依赖**：XEP-0030（服务发现）
- **实例访问**：`connection.XEP0428`
- **规范版本**：0.2.1（2024-03-20）

## 注册后行为

1. 向 disco#info 添加 `urn:xmpp:fallback:0` 特性。
2. 注册 `<fallback/>` 解析器，结果写入 `message.fallbacks`。

## 扩展字段

```typescript
interface Message {
  fallbacks?: Array<{
    for: string;   // 被回退替换的规范命名空间，如 "urn:xmpp:reply:0"
    body?: Array<{ start?: number; end?: number }>;    // 正文中的回退区间
    subject?: Array<{ start?: number; end?: number }>; // 主题中的回退区间
  }>;
}
```

区间按 Unicode 码点计（XEP-0426）；省略 `start`/`end` 表示覆盖整个元素。`<fallback/>` 没有子元素时，表示正文与主题整体都是回退内容，此时解析结果里的 `body` 与 `subject` 都是空数组；某一种元素没有子元素时，对应字段为 `undefined`。

## 公开 API

| 方法 | 说明 |
|------|------|
| `XEP0428.stripFallback(text, regions)`（静态） | 按回退区间移除文本片段 |
| `XEP0428.createFallbackEl(info)`（静态） | 构造 `<fallback/>` |
| `XEP0428.parseFallbackEl(fallbackEl)`（静态） | 从父元素收集全部 fallback；命名空间不符抛 `Error` |
| `XEP0428.NS`（静态） | `"urn:xmpp:fallback:0"` |

## 使用示例

```typescript
client.on("message", (message) => {
  const fallback = message.fallbacks?.find(
    (item) => item.for === "urn:xmpp:reply:0",
  );
  if (!fallback) return;

  // 已支持 XEP-0461，可去掉正文里的引用块
  const body = XEP0428.stripFallback(message.body ?? "", fallback.body);
  console.log(body);
});
```

发送侧与 XEP-0461 的引用回退配合：

```typescript
// msg 是已携带引用块与 <reply/> 的回复消息
msg.appendChild(
  XEP0428.createFallbackEl({
    for: "urn:xmpp:reply:0",
    body: [{ start: 0, end: quotedLength }],
  }),
);
client.send(msg);
```

## 注意事项

- 不知道本协议的客户端会照常显示完整正文，这正是回退的意义（§1）。
- `stripFallback` 的第二个参数为 `undefined` 时原文保持不变，为空数组时整段被移除；两者含义不同，不要用 `?? []` 混同。
- `start`/`end` 必须是非负整数；解析时非法值会导致所在区间被丢弃（不会退化成缺省值），生成时抛错。
- 缺少 `for` 属性时原文不完整，解析结果中的 `for` 为空串并记录警告。
- 一条消息可以有多条 fallback，按 `for` 区分；`stripFallback` 只处理调用方选中的那一条。
- 旧版本规范中用于加密消息的示例已被 XEP-0380 取代，加密场景不要使用本协议（§2）。
