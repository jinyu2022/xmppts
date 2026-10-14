# xmppjs

基于 TypeScript 的 XMPP 协议库，目标环境为 Node.js 与浏览器，扩展协议以插件形式实现。

> 当前可运行路径为 Node.js + 明文 TCP / STARTTLS；浏览器与 WSS 尚未接线。

## 功能特性

- **插件化设计** — 通过 `registerPlugin()` / `registerDefaultPlugins()` 按需加载扩展协议。
- **类型安全** — 全量 TypeScript，插件可扩充实例类型、Stanza 字段与事件映射。
- **传输层管线** — 发送 / 接收拦截器可介入 stanza 加工。
- **可观测** — 基于 loglevel 的日志系统。

## 快速开始

```typescript
import { Client } from "xmppjs";

const client = new Client("user@example.com", "password", {
  protocol: "xmpp", // 目前仅 "xmpp"（Node）可用；直连 TLS 由 XEP-0368 插件在连接前接入，无需改此项
});
client.registerDefaultPlugins();
client.on("session:start", () => {
  console.log("已登录", client.jid.toString());
});
await client.connect();
```

### 常用命令

| 命令 | 用途 |
|------|------|
| `npm run build` | 类型检查 + 打包到 `dist/` |
| `npm run dev` | 构建监听（`tsdown --watch`） |
| `npm run ts-check` | 仅类型检查 |
| `npm test` | Vitest（watch 模式；一次性运行用 `npx vitest run`） |
| `npx eslint .` | ESLint |

## 目录结构

```
├── lib/                # 核心库（connection / stanza / ltx / transport / plugins）
├── test/               # 测试（按模块组织）
├── index.ts            # 包入口
├── tsdown.config.ts    # 打包配置
└── vitest.config.ts    # 测试配置
```

- 已实现的协议清单见 [lib/README.md](lib/README.md)。
- 连接生命周期与状态机见 [lib/LIFECYCLE.md](lib/LIFECYCLE.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。这是一个 JS/TS 与 XMPP 的学习项目，不足之处欢迎指正。

## 感谢

- [XMPP.js](https://github.com/xmppjs/xmpp.js)
- [Strophe.js](https://github.com/strophe/strophejs)
- [slixmpp](https://codeberg.org/poezio/slixmpp)

## 许可证

[Mozilla Public License 2.0](./LICENSE)
