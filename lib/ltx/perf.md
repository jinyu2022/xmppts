# lib/ltx 性能报告

审阅对象：[Element.ts](Element.ts)、[LtxParser.ts](LtxParser.ts)、[Parser.ts](Parser.ts)、[escape.ts](escape.ts)、[QuerySelector.ts](QuerySelector.ts)、[XMPPElementCollection.ts](XMPPElementCollection.ts)

与 [debug.md](debug.md) 分工：debug.md 记正确性与语义问题，本文只记性能问题，且**只列当前未解决的**；已修复的部分不保留，历史见 git。

复核日期：2026-10-18。测量语料为 RFC/XEP 规范文档。

## 基准方法与语料

| 语料     | 来源                                            |   大小 |
| -------- | ----------------------------------------------- | -----: |
| `CHAT_MSG`     | RFC 6121 §5.2.2 聊天消息 + XEP-0203 §2 delay    |  341 B |
| `ROSTER`       | RFC 6121 §2.1.3 roster 结果（4 个 item）        |  566 B |
| `MUC_PRESENCE` | XEP-0045 §7.2.2 MUC 自身出席                    |  279 B |
| `DISCO_INFO`   | XEP-0030 disco#info 结果（2 identity + 8 feature） |  635 B |
| `FORM`         | XEP-0004 §3.1 表单（5 个 field）                |  512 B |
| `LONG_MSG`     | 长正文 groupchat 消息                           | 2 422 B |
| `SESSION`      | 流头 + 15 组混合 stanza + 流尾                  | 27 459 B |

| 用途       | 文件                                                       | 命令                                                                                      |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 场景绝对值 | [test/ltx/perf.test.ts](../../test/ltx/perf.test.ts)       | `npx vitest run test/ltx/perf.test.ts --disable-console-intercept`                        |
| 逐 API 绝对值 | [benchmarks/ltx.mjs](../../benchmarks/ltx.mjs)          | `node benchmarks/ltx.mjs`（完整档：`$env:LTX_BENCH="full"; node benchmarks/ltx.mjs`）|

口径：每项自适应定标迭代数后取多轮最小值（perf 5 轮、bench 9 轮），用于压制 JIT/GC 抖动。绝对值对测量上下文极其敏感——**同一文件内前后对比可信，跨文件、跨版本不可直接比较**；这也意味着判断某项改动是否有效，必须在同一文件内做 A/B（`benchmarks/ltx.mjs` 的 `abInner`）。该基准直接加载 `lib/` 的 TypeScript 源码（Node ≥ 22.18 的类型剥离加一段 `x.js` → `x.ts` 解析钩子），不需要构建产物。其中的宽树（`BIG`，50 个相同子元素）与深链（`chain`）是规模对照用的合成形状，不对应真实 stanza，只用于观察规模效应。

小效应（1%~2% 量级）与表格的分辨力：上面的"多轮取最小值"能压住组内抖动，但**压不住组间漂移**（CPU 温度/频率、后台负载）——同一组合 15 次重复，独立跑两批可以得出 +3.22% 与 +1.67% 两种结论。要判 1%~2% 的效应，可靠做法是**轮转交错 + 每轮内先算 A/B 比值再取中位数**（判据：差异须大于 2× 配对标准误，即 95% 门槛）。下文中标"配对"的数据即来自该设计，其绝对值与上文任何表都不可混比。

语料对齐了线上 XMPP 与离线解析的三点根本差别——**一条长流**（只有开头一个 `<stream:stream>`、结尾一个 `</stream:stream>`，中间 stanza 相邻且命名空间继承自流头，而不是把每条 stanza 当独立文档反复 `parse`）、**TCP 任意分片**（`SESSION` 语料按 16 KB 切片，另有整块对照）、**完整会话阶段**（XML 声明 → 流头 → `stream:features` → SASL → post-auth features → binding → 稳态 → 流尾）。合成形状的"宽树 / 深链"只用于观察规模效应，不参与真实语料结论。

环境：Windows / node v22.23.2 / Intel i5-11400H @ 2.70GHz，单线程无并发。

## 真实语料基线（ns/op，2026-10-18）

### 解析

| 语料                |    SAX |   建树 | 建树 − SAX |
| ------------------- | -----: | -----: | ---------: |
| `CHAT_MSG`          |  6 564 |  8 028 |      1 464 |
| `ROSTER`            | 11 960 | 14 993 |      3 033 |
| `MUC_PRESENCE`      |  5 274 |  6 812 |      1 538 |
| `DISCO_INFO`        | 11 559 | 16 169 |      4 610 |
| `FORM`              | 12 153 | 13 520 |      1 367 |
| `LONG_MSG`          |  2 819 |  4 443 |      1 624 |
| `SESSION` 整块      | 495 927 | 653 286 |    157 359 |
| `SESSION` 16 KB 分块 | 538 250 | 640 955 |    102 705 |

- 建树段占单条总耗时 10%（`FORM`）~ 37%（`LONG_MSG`），属性越多、元素越多，占比越高。
- `SESSION` 的 SAX 分块比整块慢约 8%（27 KB 只切 2 块）；建树两侧差异在单次运行的噪声范围内。

### 分片粒度与读缓冲

配对审阅报告在 2 MiB 真实会话（1390 条 stanza）上给出方向性结论（数字为该报告口径，不并入上表）：

- **整块写入明显慢于 16 KiB 分片**（该报告约慢两成）：单块是超长字符串，`indexOf` 要在整串上工作，且解码与处理无法重叠。
- **退到 MTU 尺寸（1448 B）也明显变慢**：每次 `write` 的固定开销（建属性表、事件派发、`TextDecoder.decode`）在 1448 字节一块时被摊得更薄。
- 64 KiB / 4 KiB / 随机 512 B–64 KiB 与 16 KiB 无显著差异；逐字节分片也能跑通全部 CDATA / 属性值 / 实体 / UTF-8 场景，**没有 O(n²) 行为**。

与上文 `SESSION` 那两条并不矛盾：27 KB 只切 2 块时，跨块 remainder 的重拼成本高于整块的成本（见「设计项」）；流再长、切块再小，整块写入的超长串扫描与"无法与解码重叠"才反过来占主导。也就是说**最优点依赖流长度与块数**，但两端的教训一致：读缓冲取 16 KiB 或 64 KiB 这一档即可，不要一次喂整块、也不要为"低延迟"退到 MTU 尺寸。

### 用法：同一条连接复用同一个 `Parser`

配对审阅报告实测的用法反模式：**每条 stanza 前重喂一遍流头**（为了保住 `xmlns` 上下文）比干净 `parse` 多花约一半时间。同一条 TCP 连接上的所有 stanza 应当喂给**同一个 `Parser` 实例**——流头只解析一次，之后每条 stanza 都能正确继承命名空间；`Parser` 实例的构造开销可忽略（实例复用、反复 `reset`、每条新建三者在吞吐上没有可分辨差异）。落地动作见「三级」的用法反面条目。

### 查询（在解析产物上）

| 调用                                           | 语料         | 耗时 |
| ---------------------------------------------- | ------------ | ---: |
| `getElementsByTagName("feature")`              | `DISCO_INFO` |  282 |
| `querySelectorAll("feature")`                  | `DISCO_INFO` | 1 399 |
| `getElementsByTagNameNS(disco, "feature")`     | `DISCO_INFO` |  972 |
| `getElementsByTagName("item")`                 | `ROSTER`     |  249 |
| `querySelectorAll("item")`                     | `ROSTER`     | 1 306 |
| `getElementsByTagNameNS(jabber:client, "item")`| `ROSTER`     |  432 |
| `querySelector(":scope > body")`               | `CHAT_MSG`   |   90 |
| `querySelector(":scope > x")`                  | `MUC_PRESENCE` | 91 |
| `querySelector(":scope > field")`              | `FORM`       |  168 |
| `querySelector("query > identity")`            | `DISCO_INFO` |  528 |
| `querySelectorAll("field")`                    | `FORM`       | 1 563 |
| `matches('[type="result"]')`                   | `DISCO_INFO` |  109 |

同树对照：`querySelectorAll` 比 `getElementsByTagName` 贵 5.0×（`DISCO_INFO`）/ 5.2×（`ROSTER`）；`getElementsByTagNameNS` 比同名的 `getElementsByTagName` 贵 3.4× / 1.7×。`:scope > ...` 走直接子元素链快速路径，约 90~170 ns；普通后代选择器（如 `query > identity`）仍走通用 DFS。

`querySelectorAll(":scope > a > b")` 与 `querySelector` 共用 `isScopedChildChain` 判定，按直接子元素链收集即为文档序，库内 13 处调用全部命中；其他选择器仍走 `findAll` 收集 + 一次文档序重排。

### 序列化

| 调用            | 语料                                     | 耗时 |
| --------------- | ---------------------------------------- | ---: |
| `toXMLString()` | `CHAT_MSG` / `ROSTER` / `DISCO_INFO`     | 2 048 / 5 977 / 5 931 |
| `toXMLString()` | `LONG_MSG`                               | 2 812 |
| `toXMLString(2)`| `CHAT_MSG`                               | 3 031 |
| `write(writer)` | `CHAT_MSG`                               | 1 502 |
| `textContent`   | `CHAT_MSG` / `LONG_MSG` / `DISCO_INFO`   | 45 / 22 / 121 |

### 属性、集合、escape

| 调用                                                    | 语料               | 耗时 |
| ------------------------------------------------------- | ------------------ | ---: |
| `getAttribute` 命中 / 缺失                              | `CHAT_MSG`         | 16 / 18 |
| `setAttribute` 覆盖                                     | `CHAT_MSG`         |   32 |
| `removeAttribute` + 复原                                | `CHAT_MSG`         |  113 |
| 首次 `setAttribute`（`EMPTY_ATTRS` 建表）               | 新建元素           |   73 |
| `createElement` 6 属性                                  | roster item 形态   |  758 |
| 集合 `length` / `[0]` / `for-of`                        | `ROSTER` item × 4  | 5 / 6 / 6 |
| `children` / `firstElementChild` / `previousElementSibling` | `FORM`         | 85 / 10 / 20 |
| `escapeXMLText` 无特殊字符 / 含 `&<>`                   | 68 字符正文        | 98 / 938 |
| `escapeXML` 属性值                                      | 45 字符            |  866 |
| `unescapeXML` 命名实体 / 短路                           | 45 字符            | 730 / 32 |
| `unescapeXMLText` 数字实体                              | 24 字符            | 1 517 |

## CPU 热点剖析

以下百分比来自 2026-10-15 的 `node:inspector` Profiler 采样（按自身耗时聚合，与吞吐表方法论不同，只用于归因）。实现此后有变动，这些百分比只保留方向性参考，不要当作当前代码的精确分布。

- **流式解析**：`LtxParser.write` 一个人占一半以上，是手写状态机的固有成本；文本态与属性值态已用 `indexOf` 跳跃，设计合理。`_handleTagOpening` 另占约八分之一，它负责建属性表、`Object.freeze` 与 `emit`。`Element.ts` 整体只占约 2%——"建树慢"不是对象分配与挂载引起的，归因见 A4。`TextDecoder.decode` 占 4% 上下（连底层约 6%），是 Buffer 输入路径的固有成本，**WebSocket 传输层直接给字符串可以省掉**。
- **查询**：`findAll` 约 43%、`traverse`（`getElementsByTagName` 内层闭包）约 19%、`matchesItem` 约 13%、`querySelectorAll` 自身约 12%、`get localName` 约 5%。这些数字对应 `querySelectorAll`。

## 新旧实现与第三方对照

- **新旧版事件模型一致**：旧 `SaxLtx` 同样继承 `EventEmitter` 并发出相同事件，"挂监听器"的代价两版都在 6%~9%，不构成差异来源。SAX 层旧版略快（约一成），端到端完整建树旧版快约 6%：差距来自状态机本身、`LtxParser` 侧属性表冻结与事件派发，以及两端输入形态不同（旧实现一次喂整条字符串，新实现喂 16 KiB `Buffer` 分片，多付 `TextDecoder` 解码）。
- **与 `saxes` 的差距不可直接比**：`saxes` 只发 opentag/closetag 回调、不建树、不管命名空间继承、不做文本反转义，慢它五成是工作量差异，不是实现缺陷。本项目的 SAX 层（不建树）正好落在旧实现与 `saxes` 之间。

## 待修问题（按修复成本 → 绝对收益排序）

**先说结论**：解析主干没有算法性陷阱（分片粒度影响 < 16%，无 O(n²)）。当前剩余收益最大的是 `toXMLString` 的逐层拼串、建树侧属性表冻结，以及 `children` 的按需过滤。

排序原则：一级是"改起来没成本"的，先清掉；二级是"绝对收益最大"的，改动面中等但值得排期；三级与设计项只登记，不排期。

> **口径**：本节带"配对"字样的数字来自 2026-10 的《ts/ltx 真实 XMPP 环境性能审阅报告》（37 条规范 stanza、2 MiB 真实会话、子进程隔离、轮转交错 + 配对比值、95% 门槛），与上文用的是不同 harness——**比值可用，绝对值不可与上文任何表混比**。该报告的结论已全部并入本文，其复现脚本（`ts-perf-audit/`、`bench-driver.mjs`、`results/all.json`）随工程布局迁移已不存在，原报告文件可以删除。

### 一级：低成本（≤10 行，行为不变）

#### C4 · `write(writer)` 每个属性 5 次回调

位置：[Element.ts#L603-L613](Element.ts#L603-L613)

```ts
writer(" ");
writer(k);
writer('="');
writer(escapeXML(v));
writer('"');
```

每个属性 5 次调用，一条 8 属性的 stanza 就是 40 次。实测 `write(writer)` 在 `CHAT_MSG`（4 元素、8 属性）上 1 502 ns。

修法：把 ` k="v"` 一次拼好、单次 `writer(...)`。收益：每次回调估算 10 ns 量级，8 属性省 32 次调用约 −320 ns/条（该语料 `toXMLString` 2 048 ns 可作上限参照）。行为不变。

### 二级：绝对收益最大（改动面中等）

#### A3 · `toXMLString` 每层返回新串、父层再 `+=`

位置：[Element.ts#L570-L579](Element.ts#L570-L579)（与 [#L598-L613](Element.ts#L598-L613) 的 `write` 是同一套语法的两份实现）

每层用模板字面量拼出完整子串返回，父层再 `+=`，递归过程中产生逐层中间串。同树对照：

| 调用                            | 语料                   | 耗时    |
| ------------------------------- | ---------------------- | ------: |
| `write(writer)`（单缓冲）       | `CHAT_MSG`             | 1 502 ns |
| `toXMLString()`（逐层拼串）     | `CHAT_MSG`             | 2 048 ns |
| `toXMLString()`                 | `DISCO_INFO`           | 5 931 ns |

`write` 比 `toXMLString` 省约 27%（`CHAT_MSG`）。`toXMLString` 仍有逐层中间串，`DISCO_INFO` 每条约 5.9 µs，改成单缓冲可再省一部分。

修法：让 `toXMLString` 内部走与 `write` 同一套**字符串累积**逻辑（上游 `src/stringify.js` 的闭包 writer 就是这种形态），缩进分支保留现有 `every()` 预扫描语义；`toString()` 随之受益。**两个坑**：(1) 不要把输出收集到数组再 `join("")`——配对实测 join 版比现状慢 **41.9%**（87.70 → 124.89 µs，门槛 ±1.29%）；(2) 需保证输出逐字节不变（缩进、自闭合、`escapeXML`/`escapeXMLText` 的选择），回归用 `test/ltx/Element.test.ts` 与 `test/ltx/Parser.test.ts` 的既有用例。要往 socket 直接写时本来就应该用 `write(writer)`（`CHAT_MSG` 上比 `toXMLString()` 快约 27%）。

#### A4 · 建树侧的属性表冻结成本

位置：[Parser.ts](../../lib/ltx/Parser.ts) 的 `startElement`/`endElement` 回调 + [Element.ts#L38](Element.ts#L38)（`_ensureAttrs`）+ [LtxParser.ts#L82](LtxParser.ts#L82)

perf 单次运行里 `SESSION` 27 KB 建树 653 µs；建树段（总耗时 − SAX 段）在真实语料上是 1.4 µs（`CHAT_MSG`）~ 4.6 µs（`DISCO_INFO`）/条。

配对实测把根因指到了属性表的所有权机制，而不是对象分配：

| 机制 | 成本 | 门槛 |
| --- | ---: | ---: |
| `LtxParser` 侧冻结 + `_ensureAttrs` 的 `Object.isFrozen` 判定 | **+13.34%** | ±1.32% |
| `EventEmitter` 的 3 个事件 | 约 6%~9% | — |

约 13.3% 来自 `LtxParser` 侧冻结与 `_ensureAttrs` 的所有权判定。`_ensureAttrs` 的形态是每次写属性都复制整张表——牺牲出站构树的写属性性能，并失去"`startElement` 监听方拿到的表不被元素改动"这一保护。

修法：这一包拆不开，要既快又保留语义，需要把"是否拥有属性表"改成**显式状态字段**（[Element.ts#L38](Element.ts#L38) 一带），属新增状态的改动。此外每标签 1~2 次 `emit` 透传与 `stream:stream` / `streamRoot` 判定是 XMPP 语义必需的，不应为降低这项成本而删。收益量级：27 KB 会话流省 ~50 µs，折算到 1 MB/s 持续流量约 −0.19% CPU——价值在于它是稳态成本，不是单条的 µs 数。

#### A5 · `children` 每次访问重建元素数组

位置：[Element.children](Element.ts#L239-L247)

perf 实测（`FORM`）：`children` 85 ns，`firstElementChild` 10 ns。200 子节点的配对实测中 `childNodes` 为 0.038 µs（零分配下界），`children` 的成本集中在“遍历子节点、过滤元素、建数组”。

修法：**库内不缓存**——lib 中每个元素的 `children` 基本只读一次（12 处调用均为一次性遍历/转换），缓存只会给每个节点增加字段与维护成本。热路径优先用零分配的 `childNodes`、`firstElementChild`、`childElementCount`；需要 DOM 风格集合时才用 `children`。

### 三级：低收益，暂不处理

- **序列化不要收集到数组再 `join`**：配对实测比现状慢 41.9%（87.70 → 124.89 µs）。要往 socket 直接写就用 `write(writer)`。
- **`getElementsByTagName` 不要改成显式栈**：配对实测迭代版比递归版慢 11.1%（2.169 → 2.402 µs，门槛 ±4.57%）。深树栈溢出的处理见 debug.md SEC-002，不要在热路径上做这次改写。
- **`namespaceURI` 每次上溯、无缓存**：深度 5 约 25 ns（bench），XMPP 报文深度 ≤ 8，一次全树 NS 查询在真实语料上是 0.7~1.0 µs（见上文「查询」表）。缓存要处理节点移动、祖先增删 `xmlns` 的失效，收益不抵复杂度。
- **兄弟轴 O(k²)**：[Element.ts#L282-L295](Element.ts#L282-L295) 的 `previousElementSibling` 与 [#L297-L310](Element.ts#L297-L310) 的 `nextElementSibling` 都用 `_childNodes.indexOf(this)` 定位，每次 O(兄弟数)；`~` 组合符的链式收集（[QuerySelector.ts#L194-L206](QuerySelector.ts#L194-L206)）因此是 O(k²)。`lib/` 全量搜索无 `+` / `~` 调用点，先登记：修法可选元素级缓存"子元素数组 + 兄弟下标"，或把 `~` 分支改成一次线性扫描。
- **相邻文本节点不合并**：与 DOM 语义一致（真 DOM 也不自动合并，需 `normalize()`），且只在"注释/指令/CDATA 夹在文本之间"或调用方多次 `append` 时产生，属非缺陷。
- **`createElement` 走 null-proto 逐键写入**（6 属性 758 ns；bench 4 属性 324.6 ns）：换取的是 `__proto__` / `constructor` 这类属性名的安全，代价约 +53 ns/属性，而且只有出站构造路径付（解析路径已接管冻结表）。
- **`_findNS` / 遍历改迭代**：只对深树值钱（XMPP 深度 ≤ 8），且注意上一条的配对结论（无脑迭代化可能更慢）。深链栈溢出属 [debug.md](debug.md) 的 SEC-002。
- **`EventEmitter` 的 3 个解析事件**：配对实测约 6%~9%，收益有限。
- **用法反模式：每条 stanza 重喂流头**：配对实测比复用 `Parser` 实例多花 **49.31%**（3.565 vs 2.365 µs，门槛 ±3.80%）。同一条 TCP 连接上的所有 stanza 应当喂给同一个实例（复用 vs 每条新建的构造开销可忽略：89.03 vs 88.07 MiB/s）。库这边可做的是在 [lib/README.md](../README.md) 或 `Parser.parse()` 的文档里写明"仅用于单条 stanza，流式场景请复用实例"。
- **`unescapeXMLText` 的数字实体**：每次调用 1 517 ns（数字实体要 `String.fromCodePoint`，是反转义里最贵的一支）；`unescapeXML` 命名实体 730 ns / 45 字符、无实体短路 32 ns，无特殊字符的 `escapeXMLText` 98 ns / 68 字符。XMPP 正文里最常见的是 URL 里的 `&`，密度上不去。
- **`appendChild` / `insertBefore` 的 `instanceof` 校验**（[Element.ts#L456-L459](Element.ts#L456-L459)、[#L464-L472](Element.ts#L464-L472)）：解析器“新建后立即挂载”会对每个节点多付一次 `_assertElement`。没有单独测量；按“Element.ts 整体只占约 2%”（上文热点剖析）推断量级很小，先登记不排期。若要评估，用 `abInner` 做 A/B，不要跨 harness 比绝对值。

### 设计项（策略决定，与缺陷修复解耦）

- **跨块 remainder 每次重拼**（[LtxParser.ts#L112](LtxParser.ts#L112)、[#L338](LtxParser.ts#L338)）：长文本跨多个小块且块内无 `<` 时，每次 `write` 都把旧 remainder 与新块拼成 ConsString，随后 fast-path 的 `indexOf` 触发扁平化，总复制量 ∝ N²/块长。真实语料下不显形——`SESSION` 27 KB 切 16 KB × 2 块，分块 SAX 比整块慢约 8%（495 927 → 538 250 ns），建树两侧差异在噪声内（653 286 / 640 955 ns）。要处理的前提是先确认实际读块尺寸（socket / TLS 记录），块越小放大越厉害。
- **输入资源上限**：单 stanza 大小 / 嵌套深度 / 未完成 token 长度，目前都没有限制。这是策略决定，不是性能缺陷，见 [debug.md](debug.md) 的 SEC-002。
- **查询结果缓存**：happy-dom 用 per-node 结果缓存 + 失效广播。是否值得做取决于插件对同一条 stanza 的重复查询频率——先量再定，现在没有数据支持。

## 本文局限

- 绝对值只出自单机单进程、同一 Node 版本；跨平台（尤其 arm64）未复测，不同 harness 的绝对值不可混比。
- 没有做并发 / 多连接压力测试（结论覆盖的是单线程吞吐与单连接语义）。
- 没有测 XML 炸弹、超长属性等恶意输入的防护成本——那是资源上限策略，属 [debug.md](debug.md) SEC-002。
- `QuerySelector` 的选择器解析缓存（上限 1000 条、溢出后整表清空）没有专项测试，高基数选择器场景下可能抖动。
- 配对审阅报告里的正确性缺陷（`?>` / `-->` 跨块状态机、`Parser.end()` 重复投递末条 stanza 等）按分工记在 [debug.md](debug.md)，不在本文范围。
