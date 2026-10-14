# lib/ltx 性能报告

审阅对象：[Element.ts](Element.ts)、[LtxParser.ts](LtxParser.ts)、[Parser.ts](Parser.ts)、[escape.ts](escape.ts)、[QuerySelector.ts](QuerySelector.ts) 及调用侧 [connection.ts](../connection.ts)


> 总评：性能问题集中在解析器 fast-path 的**回退路径**（落空后逐字符推进，代价升为平方级，P1/P9）与热路径上的**重复计算/分配**（P3-P8、P10-P12）。其余条目在典型负载下影响有限，列出是为了给出数据基线，修复紧迫度低。
> **状态（2026-10-12）：P1/P9 已修复**——四处 fast-path 落空统一结束本块扫描，单块 write 16KB~128KB 五态（纯文本 / 未闭合属性值 / 未闭合注释 / 未闭合 CDATA / 块尾为 `]` 的 CDATA）均 ≤0.01ms（修复前三态 16KB≈4.2ms、128KB≈215ms）；**P2 的平方退化面随之消除，但其吞数据缺陷未修**（跨块 `-->`/`?>` 仍丢后续数据、`]]>` 后文本仍丢）；P3 已惰性化（修复）；P4-P8、P10-P13 为现状测量。

## 基准方法

- 基准文件：[test/ltx/perf.test.ts](../../test/ltx/perf.test.ts)，可重复运行
- 运行：`npx vitest run test/ltx/perf.test.ts --disable-console-intercept`
- 方式：每项执行多轮取最小值（压 JIT/GC 抖动），只反映数量级与增长趋势，非精确值
- 环境：Windows / node v22.23.2 / Intel i5-11400H；单线程、无并发干扰

## 结论摘要（按实测影响排序）

| 编号 | 问题                                   | 位置                                                                     | 实测影响                                                                                                     | 评级  |
| ---- | -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----- |
| P1   | fast-path 落空后平方级退化（**已修复**） | [LtxParser.ts#L126-L171](LtxParser.ts#L126-L171)                         | 四处分支落空即结束本块扫描；单块 16KB~128KB 均 ≤0.01ms（修复前三态 16KB≈4.2ms、128KB≈215ms） | 已修复 |
| P9   | ATTR_VALUE/COMMENT/CDATA 未命中同型退化（**已修复**，并入 P1） | [LtxParser.ts#L134-L171](LtxParser.ts#L134-L171)                         | 修复前单块 16KB≈4.1ms、128KB≈215ms（近平方）；修复后五态单块 16KB~128KB 均 ≤0.01ms，128KB 分 16KB 块 0.01~0.25ms | 已修复 |
| P2   | 注释/指令跨 write 边界吞数据（上游同款）；CDATA 后文本丢 | [LtxParser.ts#L230-L261](LtxParser.ts#L230-L261)                         | 跨块注释后的元素直接丢失；`]]>` 后文本被吞（均未修）；未闭合注释 128KB 曾实测 219.53ms，2026-10-12 随 P9 修复降至 0.01ms | 中    |
| P10  | `:scope > ...` 查询仍遍历整棵子树 | [QuerySelector.ts#L62-L75](QuerySelector.ts#L62-L75)、[#L113-L128](QuerySelector.ts#L113-L128) | 1000 子 × 100 后代树：`":scope > item"` 6.363ms ≈ 全树查询 6.256ms；纯直接子对照 0.195ms（约 30× 余量） | 中    |
| P11  | `getElementsByTagNameNS` 先算 NS 后比 localName、递归上溯 | [Element.ts#L265-L282](Element.ts#L265-L282)                             | 1000 层链 5.8~6.1ms（∝n²；localName 不匹配时同价）；4000 层深链冷启动 RangeError（栈溢出） | 中    |
| P12  | 跨块 remainder 每次重拼，`indexOf` 触发 ConsString 扁平化 | [LtxParser.ts#L106-L111](LtxParser.ts#L106-L111)、[#L323-L326](LtxParser.ts#L323-L326) | 1MB 纯文本：单块 0.03ms；16KB 分块 13.82ms；4KB 54.96ms；1KB 222.63ms（∝ N²/块长） | 中-低 |
| P3   | 入站 stanza 序列化（**已修复**：参数惰性化） | [connection.ts#L561](../connection.ts#L561)                              | 原为 debug 关闭时也全量序列化（小 stanza 0.99μs/条、50 子元素 32.8μs/条）；现传 thunk，禁用级别不求值 | 已修复 |
| P7   | 相邻文本节点不合并（非缺陷/实现取舍，仅注释/指令/CDATA 夹在文本间时触发） | [Element.ts#L393-L401](Element.ts#L393-L401)                             | 1000 碎片 vs 单串：`textContent` 慢 39×、`toXMLString` 慢 20×；普通 stanza 不触发                        | 低（非缺陷） |
| P4   | 解析建树的固定分配                     | [LtxParser.ts#L176](LtxParser.ts#L176)、[Element.ts#L54](Element.ts#L54) | 元素创建 208ns/个（+4 属性 412ns）；`Object.create(null)` 132ns vs `{}` 83ns；`emit` 25ns/次                 | 低    |
| P5   | `namespaceURI` 无缓存，每次上溯        | [Element.ts#L98-L126](Element.ts#L98-L126)                               | 40ns/次（`tagName` 对照 2ns）；1000 元素全树 NS 查询 0.275ms                                                 | 低    |
| P6   | `querySelector` 匹配阶段逐元素分配     | [QuerySelector.ts#L599](QuerySelector.ts#L599)                           | 1000 元素查 `.class` 0.162ms/次，纯标签 0.049ms（3.3×）                                                      | 低    |
| P8   | `escapeXML*` 正则逐次字面量、实体回调  | [escape.ts#L69-L108](escape.ts#L69-L108)                                 | 纯文本 1884MB/s；特殊字符密集 16MB/s（118×）；unescape 实体 56MB/s vs 无实体 40GB/s                          | 低    |
| P13  | 兄弟组合符 `+`/`~` 逐候选 `indexOf` 定位 | [QuerySelector.ts#L665](QuerySelector.ts#L665)、[#L678](QuerySelector.ts#L678) | w=1000→4000：`"item + item"` 0.417→2.454ms（纯 `"item"` 仅 ×1.4）；业务代码无 `+`/`~` 调用 | 低    |

---

## 与上游 ltx 对照（复用其 benchmarks 数据）

上游 `ltx-main/benchmarks/` 自带 `data.xml`（528B，单属性 + 长文本）与 parser/serialize 套件。为判定 P1/P2 等是"本库独有"还是"随上游继承"，用同一份数据、同一个上游解析器实例做对照（不安装任何第三方包，自写 `hrtime` 计时）。测量方式为 **A/B 交错采样**：每轮先跑上游再跑本项目，共 25 轮（快用例放大单轮迭代数），主值取轮均值，括号为变异系数 CV；**先跑完一方再跑另一方的顺序跑法会引入约 5%~10% 的系统偏差**。数值以 ops/sec 计（越大越快），与上游 `benchmark` 包口径一致。

脚本：[../../_temp_copilot_bench.mjs](../../_temp_copilot_bench.mjs)，运行 `node _temp_copilot_bench.mjs`。

| 用例                            | 上游 ltx (ops/sec)   | 本项目 (ops/sec)     | 本项目/上游 |
| ------------------------------- | -------------------- | -------------------- | ----------- |
| parse data.xml (528B)           | 632,435 (±7.4%)      | 533,204 (±6.3%)      | 0.84x       |
| parse 拼接 100x (52KB, 有标签)  | 10,032 (±10.3%)      | 8,907 (±7.8%)        | 0.89x       |
| parse 纯文本 52KB（无 `<`）     | 241,332 (±4.7%)      | 246,844 (±5.2%)      | 1.02x       |
| stream write 拼接 100x 单块     | 11,311 (±9.6%)       | 12,297 (±8.8%)       | 1.09x       |
| stream write 拼接 100x 分 16KB  | 10,457 (±13.0%)      | 11,672 (±9.0%)       | 1.12x       |
| stream write 纯文本 52KB 单块   | 325,473 (±5.4%)      | 326,491 (±5.3%)      | 1.00x       |
| stream write 纯文本分块 16KB    | 85 (±8.2%)           | 86 (±9.6%)           | 1.01x       |
| serialize data.xml 树           | 954,430 (±19.9%)     | 739,799 (±14.9%)     | 0.78x       |
| serialize 单树 100 子元素 (53KB) | 9,691 (±9.0%)        | 7,437 (±7.5%)        | 0.77x       |

结论（分项，非"整体更慢"）：

- **流式 write 更快 9%~12%**，与注释/处理指令退出时补 `recordStart` 的改动一致；纯文本路径（1.00x~1.02x）两侧持平。
- **parse 慢 11%~16%**（0.84x~0.89x），代价在建树侧而非状态机：`startElement` 走 `createElement` + `_applyAttrs` + `setAttribute`（含 `String()` 转换）比上游 `new Element` 多一层（[Parser.ts#L70](Parser.ts#L70)、[Element.ts#L133-L149](Element.ts#L133-L149)）；另有为 XMPP 流语义增加的 `stream:stream` 判定与 `startElement`/`endElement` 转发 emit（上游 Parser 只内部处理）。**2026-10-11 更正**：早前把 `appendChild → insertBefore` 内含 `includes`/`indexOf` 列为原因；实际参考节点为 null 时两处查找均被短路，解析新节点也无父节点（`removeChild` 不执行），普通建树不经过逐兄弟扫描（[Element.ts#L326-L357](Element.ts#L326-L357)）。
- **serialize 慢 22%~23%**（0.77x~0.78x，两组样本 CV 均 <15%，结论最可信）：上游 `toString()` 经闭包 `writer` 累积到单个字符串；`toXMLString` 每层用模板字面量拼接并返回新字符串，父层再 `+=`，多了逐层中间串分配（[Element.ts#L409-L457](Element.ts#L409-L457)）。
- ~~**P1 仍是最大绝对值差异**：纯文本 write 单块 326,491 ops/sec vs 分块 16KB 的 86 ops/sec（约 3800x），且上游同值（325,473 / 85）→ 分块路径坍塌，双方共病。~~ **2026-10-11 复核更正**：本仓库的 TEXT **单块**坍塌已修复（332ms → 0.01ms），但**分块路径未消除**——慢点不是 TEXT 推进，而是 remainder 每次重拼（见 P12）：1MB 纯文本单块 0.03ms vs 16KB 分块 13.82ms、1KB 分块 222.63ms。上游未动；上表"本项目"列的两行 write 数据为此前状态，待重跑对照脚本。
- 528B 这类微用例 CV 偏高（7%~20%）只作趋势参考；53KB 用例 CV <10% 可信度更高。

---

## 高

### P1. fast-path 落空后逐字符推进，代价平方级（**已修复**，2026-10-12）

位置：[LtxParser.ts#L126-L133](LtxParser.ts#L126-L133)（TEXT）、[#L134-L146](LtxParser.ts#L134-L146)（ATTR_VALUE）、[#L147-L157](LtxParser.ts#L147-L157)（COMMENT）、[#L158-L171](LtxParser.ts#L158-L171)（CDATA）

`write()` 主循环每轮先做 fast-path 跳跃（下例为修复后的 ATTR_VALUE 分支，四处同形）：

```ts
case STATE_ATTR_VALUE: {
  if (this.attrQuoteChar) {
    const quot = currentData.indexOf(this.attrQuoteChar, pos);
    if (quot !== -1) {
      pos = quot;        // 命中：跳到结束引号
    } else {
      break scan;        // 落空：块内已无结束符，结束本块扫描
    }
  }
  break;
}
```

修复前：块内找不到结束符时（跨块属性值的前段），`pos` 每轮只 +1，而每轮都重跑一次 `indexOf(…, pos)` 扫描到块尾 → 比较次数 ≈ m²/2（m 为块内剩余长度）。**代价由单次 write 的块长决定，与累计流量无关**；COMMENT、CDATA 两个 fast-path 同型（见 P9）。CDATA 分支与另三处略有差别：块尾为 `]` 时不能直接结束扫描，须先定位到该字符、由原有的 `parseRemainder` 分支（[#L203-L207](LtxParser.ts#L203-L207)）保留跨块拼接识别。

修复前实测（2026-10-06，TEXT 分支尚未修复；单块 write，min/3 轮；单位 ms）：

| 数据量 | 单块 write | 切成 16KB 块 | 每 512 字符夹 `<a/>` |
| ------ | ---------- | ------------ | -------------------- |
| 16KB   | 3.65       | 3.64         | 0.03                 |
| 32KB   | 13.73      | 7.42         | 0.06                 |
| 64KB   | 50.93      | 14.47        | 0.11                 |
| 128KB  | **206.88** | 28.02        | **0.22**             |

- 单块：×4 倍数据 → ×4 倍耗时（严格平方），128KB 纯文本卡事件循环约 207ms
- 分块只把平方基数降到块级：每 16KB 块仍固定 ~3.6ms
- 有标签命中 fast-path 时快约 1000×：说明慢的只是"落空后的推进方式"

触发场景：一次 write/socket 读块内含长纯文本（大正文、keepalive 外的空白段）或未闭合的属性值/CDATA/注释。STARTTLS 前明文或 TLS 记录整合后 64KB 级读块完全可能；修复前非 TEXT 三态每块多花数 ms、128KB 单块可达 ~215ms。

落地方式：落空时结束本块扫描（`break scan`），残留由 remainder 机制（`recordStart`，[#L323-L326](LtxParser.ts#L323-L326)）保存，语义不变。三处分支各自的注意点：ATTR_VALUE 的结束符是单字符，跨块不受分片影响；COMMENT 的内容本就丢弃，无需 remainder 参与；CDATA 的 `]]>` 可能被 write 边界切开，块尾为 `]` 时先定位到该字符、由既有 `parseRemainder` 分支保留，其余情况才 `break scan`。

**修复经过**：TEXT 分支于 2026-10-07 先落地 `break scan`（块内已无 `<`，继续逐字符推进只会让 `indexOf` 反复重扫块尾）；其余三处（ATTR_VALUE / COMMENT / CDATA）于 2026-10-12 统一，全文件 `break scan` 共四处（[#L130](LtxParser.ts#L130)、[#L142](LtxParser.ts#L142)、[#L154](LtxParser.ts#L154)、[#L168](LtxParser.ts#L168)）。2026-10-11 复核记录的三态退化（128KB 单块 214~220ms）已消除，数据见 P9。

同进程 A/B 交错采样（旧实现取改动前的 dist 产物，5 轮取最小值、每轮 3 次，单位 ms）：

| 用例                                 | 修复前  | 修复后 | 提速       |
| ------------------------------------ | ------- | ------ | ---------- |
| plain 16KB 单块                      | 5.77    | 0.00   | 3146x      |
| plain 32KB 单块                      | 21.49   | 0.00   | 5284x      |
| plain 64KB 单块                      | 83.22   | 0.01   | 16003x     |
| plain 128KB 单块                     | 332.05  | 0.01   | **46118x** |
| open-comment 16KB 单块               | 6.01    | 0.00   | 1918x      |
| open-comment 128KB 单块              | 337.84  | 0.01   | 50423x     |
| tagged 128KB 单块（对照：命中 fast-path） | 0.50 | 0.51   | 1.0x       |

- 修复后耗时与块长脱钩（16KB 与 128KB 同为 0.01ms）；对照用例 1.0x，命中路径未被拖慢
- 语义：以改动前的 dist 实现为对照，对 25 组输入（含注释/指令/CDATA 跨块、属性值未闭合、`]]`/`]` 边界、多 stanza 混合）的全部二段与三段切分点比对事件流，逐条一致
- 2026-10-11 复核曾指出 `open-comment` 两行与当时源码不符——COMMENT 分支未命中时不跳出，128KB 未闭合注释实测 219.53ms（见 P9）；2026-10-12 修复后该行成立，未闭合注释 128KB 单块实测 0.01ms；plain 四行复现（16KB~128KB 均 ≤0.01ms）。

### P9. ATTR_VALUE/COMMENT/CDATA 未命中同型退化（**已修复**，2026-10-12，并入 P1）

位置：[LtxParser.ts#L134-L146](LtxParser.ts#L134-L146)（ATTR_VALUE）、[#L147-L157](LtxParser.ts#L147-L157)（COMMENT）、[#L158-L171](LtxParser.ts#L158-L171)（CDATA）

三个分支与 P1 的 TEXT 同一结构：`indexOf` 找结束符（引号 / `-->` / `]]>`），未命中时不结束本块扫描，而是由 `for` 的 `pos++` 逐个字符推进，每轮重扫块尾 → 块内 m 字符的未闭合片段代价 ≈ m²/2。**不需要非法输入即可触发**：合法的长属性值（base64 附件、长 vCard 字段）、跨块 CDATA、未闭合注释，只要结束符在块外（网络分块截断）就进入该路径。2026-10-12 已按 P1 的方式修复。

修复前 2026-10-11 复核实测（单块 write，min/3 轮，node v22.23.2 同机）：

| 数据量（状态） | 16KB | 32KB | 64KB | 128KB |
| -------------- | ---- | ---- | ---- | ----- |
| text（已修对照） | 0.00 | 0.01 | 0.00 | 0.00 |
| attr-value `<m a="…` | 4.14 | 14.02 | 54.52 | 216.58 |
| comment `<!-- …` | 4.25 | 14.51 | 55.71 | 219.53 |
| cdata `<m><![CDATA[…` | 4.09 | 14.28 | 54.70 | 214.21 |

- 三状态近平方：×4 数据 → ×3.4~4 耗时，16KB→128KB 累计 ×52，128KB 单块阻塞事件循环 ~215ms
- 分块只降低平方基数：128KB 分 16KB × 8 块实测 attr-value 30.34ms / comment 31.75ms / cdata 31.05ms（每块 ~4ms）
- 触发面：单块内未闭合片段的长度；接收路径 socket 读块 64KB 级时单块可达 ~55ms

修复后 2026-10-12 复测（[perf.test.ts](../../test/ltx/perf.test.ts) 的 P9 段 + P2 段的 open-comment 行；单块 write，min/3 轮；单位 ms）：

| 数据量（状态）           | 16KB | 32KB | 64KB | 128KB | 128KB 分 16KB 块 |
| ------------------------ | ---- | ---- | ---- | ----- | ---------------- |
| text（对照）             | 0.00 | 0.00 | 0.00 | 0.00  | 0.07             |
| attr-value `<m a="…`     | 0.00 | 0.00 | 0.00 | 0.01  | 0.16             |
| comment `<!-- …`         | 0.00 | 0.00 | 0.01 | 0.01  | 0.01             |
| cdata `<m><![CDATA[…`    | 0.00 | 0.00 | 0.00 | 0.01  | 0.25             |
| cdata 块尾为 `]`         | 0.00 | 0.00 | 0.00 | 0.01  | 0.11             |

- 五态单块耗时与块长脱钩（16KB~128KB 均 ≤0.01ms），128KB 由 214~220ms 降至 0.01ms
- 分块路径残留的是 P12 的 remainder 重拼成本（128KB 分 16KB 块 ≤0.25ms），与状态机推进无关
- 回归：`npx vitest run test/ltx` 全绿（含跨 `]]`/`]` 分片的既有 CDATA 用例）；另验证块尾为 `]`/`]]` 时跨块 `]]>` 仍能识别（`text:"ab"` 正常上报）

落地方式：与 P1 相同，未命中时结束本块扫描（`break scan`），待下一块继续。ATTR_VALUE 的未完成内容由写回处 `remainder = currentData.slice(recordStart)`（[#L323-L326](LtxParser.ts#L323-L326)）保留，引号为单字符、跨块不受分片影响；COMMENT 的内容本就丢弃，无需 remainder 参与；CDATA 块尾为 `]` 时先定位到该字符、由既有 `parseRemainder` 分支（[#L203-L207](LtxParser.ts#L203-L207)）保留跨块拼接识别，其余情况才 `break scan`。**本次未补 COMMENT/指令态的跨块结束符识别**——被 write 边界切开的 `-->`/`?>` 仍会吞掉后续数据（P2，未修）。

## 中

### P2. 注释/指令跨 write 边界：吞数据（上游 xmppjs/ltx 同款，未修）+ 同型平方退化（已随 P9 修复）

位置：[LtxParser.ts#L230](LtxParser.ts#L230)、[#L235](LtxParser.ts#L235)（进入时 `recordStart = undefined`）、[#L243-L252](LtxParser.ts#L243-L252)（注释关闭）、[#L254-L261](LtxParser.ts#L254-L261)（指令关闭）

现实性分层：**处理指令**主要是 `<?xml version='1.0'?>` 声明（§11.5 要求流头前 SHOULD 发送，重连/重启时反复出现），跨块切开即永久吞数据——高相关；**注释**属 §11.1 prohibited 但被广泛容忍（RFC 自己在 §4.9.3.18 用注释触发 `<restricted-xml/>`，说明确有实现会发），命中率低但同样致命；**CDATA section** 不在 §11.1 禁列（禁列仅注释/PI/DTD/非预定义实体），是合法语法，`]]>` 后文本丢失属真缺陷。

关闭检测只回看**当前块内**前两个字符：

```ts
if (c === 62 /* > */) {
  const prevFirst = currentData.charCodeAt(pos - 1);
  const prevSecond = currentData.charCodeAt(pos - 2);
  if (prevFirst === 45 && prevSecond === 45) { this.state = STATE_TEXT; ... }
}
```

若 `-->`（或 `?>`）恰好被 write 边界切开（如上一块以 `--` 结尾、下一块以 `>` 开头），`charCodeAt(-1/-2)` 为 NaN，识别失败；而进入注释时 `recordStart = undefined`，无 remainder 可恢复 → 后续数据在注释态里被吞，直到块内再次出现 `-->`，否则一直吞。CDATA 因 `parseRemainder`（[#L203-L207](LtxParser.ts#L203-L207)）不受影响。

实测（先 `write(前半)` 再 `write(后半)`，记录事件流；上游用 xmppjs/ltx 的 SaxLtx 同条件对照）：

| 场景                                               | 上游 xmppjs/ltx        | 本仓库 LtxParser   |
| -------------------------------------------------- | ---------------------- | ------------------ |
| `"<!-- c --"` + `"><m/>"`（跨块注释）              | 元素丢失 `(empty)`     | 元素丢失 `(empty)` |
| `"<?pi ?"` + `"><m/>"`（跨块指令）                 | 元素丢失 `(empty)`     | 元素丢失 `(empty)` |
| `"<!--x-->hello"` + `"<b/>"`（同块注释后文本）     | **文本 "hello" 丢失**  | 文本保留           |
| `"<m><![CDATA[ab]"` + `"]]>c</m>"`（CDATA 后文本） | 文本 "c" 丢失          | **文本 "c" 丢失**  |

**上游同款**：该缺陷逐行来自上游 [ltx-main/src/parsers/ltx.js](../../../ltx-main/src/parsers/ltx.js)——进入注释/指令清 `recordStart`、关闭检测回看块内两字符、关闭后不重设 `recordStart` 均在 [#L156-L184](../../../ltx-main/src/parsers/ltx.js#L156-L184)；P1 的 fast-path 落空同型也在上游（[#L73](../../../ltx-main/src/parsers/ltx.js#L73)）。本仓库在注释（[LtxParser.ts#L250](LtxParser.ts#L250)）与指令（[#L260](LtxParser.ts#L260)）退出处已补 `recordStart`，CDATA 退出（[#L202](LtxParser.ts#L202)）**未补**，`]]>` 后紧跟的文本会被吞（对照表末行）。

另：注释未闭合时（块内无 `-->`）命中同款 fast-path 落空，退化与 P1 完全一致：

| 数据量                 | 16KB | 32KB  | 64KB  | 128KB    |
| ---------------------- | ---- | ----- | ----- | -------- |
| `"<!-- " + "x"×n` 单块 | 4.60 | 14.05 | 52.01 | 214.74ms |

（该表为修复前数据。2026-10-11 复核证实当时仍成立（128KB 219.53ms）；2026-10-12 随 P9 修复降至 0.01ms。**P2 的吞数据缺陷仍未动**——修复只去掉平方退化，没有补跨块结束符识别状态。）

修法：二选一。(a) 关闭检测改为"保留块尾 2 字符为 remainder"（在写回处对 COMMENT/INSTRUCTION 状态切片 `currentData.slice(-2)` 并置 `parseRemainder`），(b) 进入注释/指令时先 `recordStart = pos`，关闭判定失败时把切片交给下一次 write 重新识别。连同 P1 一并修复时，注意两条路径共享写回逻辑。顺带在 CDATA 退出处补 `recordStart = pos + 3`（[LtxParser.ts#L201-L202](LtxParser.ts#L201-L202)，`]]>` 占 pos~pos+2），消除 `]]>` 后文本被吞。

### P3. 入站 stanza 序列化（**已修复**：参数已惰性化）

位置：[connection.ts#L561](../connection.ts#L561)

当前源码为 `log.debug("receive", () => stanza.toXMLString())`：`log.ts` 的 methodFactory 在启用级别下逐参求值 thunk（[log.ts#L25-L28](../log.ts#L25-L28)），禁用级别由 loglevel 直接赋 noop、闭包体不执行 → debug 关闭时零成本。下表为惰性化前的历史测量（保留作参考）；2026-10-11 复核确认"debug 关闭时也白跑"的描述已不适用：

| 形态                      | 单次成本 | 100 条/s | 1000 条/s            |
| ------------------------- | -------- | -------- | -------------------- |
| 小 stanza（body 11 字符） | 0.99μs   | 0.10ms/s | 0.99ms/s（0.1%）     |
| 大 stanza（50 子元素）    | 32.8μs   | 3.3ms/s  | 32.8ms/s（3.3% CPU） |

触发场景：MUC 活跃房、大 vCard/表单 stanza（debug 开启时仍有上述序列化成本，属预期）。

### P10. `:scope > ...` 查询仍遍历整棵子树

位置：[QuerySelector.ts#L62-L75](QuerySelector.ts#L62-L75)（`querySelectorAll`）、[#L113-L128](QuerySelector.ts#L113-L128)（`findFirst`）

两个遍历函数无论选择器是什么，检查完候选后都会无条件 `pushChildren` 压入其后代（[#L130-L138](QuerySelector.ts#L130-L138)）。因此 `:scope > field` 这类只需直接子节点的查询，进入孙节点后（已不可能匹配）仍会遍历其全部后代。调用点集中在解析侧：表单字段/值 [xep0004/form.ts#L92](../plugins/xep0004/form.ts#L92)、[#L113](../plugins/xep0004/form.ts#L113)；vCard 字段 [xep0054/vcardTemp.ts#L66-L68](../plugins/xep0054/vcardTemp.ts#L66-L68)；pubsub [xep0060/pubsub.ts#L560](../plugins/xep0060/pubsub.ts#L560)；另见 [errors.ts#L68](../errors.ts#L68)、[stanza.ts#L60](../stanza.ts#L60)。

2026-10-11 复核实测（root 下 1000 个直接 `item`；深树版本每个 item 再挂 100 个 `child`，共 101k 节点；min/5）：

| 查询 | 宽树（1k 节点） | 宽+深树（101k 节点） |
| ---- | --------------- | -------------------- |
| `":scope > item"` | 0.195ms | 6.363ms |
| `"item"`（全树，对照） | — | 6.256ms |

`:scope > item` 在深树下的成本与全树查询持平 → 证实遍历了全部后代（若只遍历直接子应 ≈0.2ms），潜在收益约 30×。

修法：对解析结果中"`:scope` + 单个 `>` 组合 + 单组选择器"的形态（`steps.length === 2 && steps[1].combinator === ">" && steps[0].compound.scope`，且首段除 `:scope` 无其他条件），直接遍历 `node.childNodes` 过滤元素并匹配第二步复合选择器；`querySelector` 命中即返回，不必先把兄弟全部压栈。**不适用**：`:scope > a b`（后续仍有组合符）、多组逗号选择器需按组判断；`matches()` 语义不变。

### P11. `getElementsByTagNameNS` 先算 NS 后比 localName、深链递归上溯

位置：[Element.ts#L265-L282](Element.ts#L265-L282)

遍历中对每个后代先求值 `nsMatch = ns === "*" || child.namespaceURI === ns`，再算 `nameMatch`（[#L274-L275](Element.ts#L274-L275)）。`namespaceURI`（[#L98-L105](Element.ts#L98-L105)）在元素自身无 `xmlns` 声明时沿 `_findNS` 递归上溯父链（[#L107-L126](Element.ts#L107-L126)），全树查询最坏 O(n·h)——即使 localName 不匹配也要付上溯成本。调用方普遍只需第一项：`getElementsByTagNameNS(...)[0]` 见 [rfc6121/index.ts#L68](../plugins/rfc6121/index.ts#L68)、[xep0030/disco.ts#L31](../plugins/xep0030/disco.ts#L31)、[xep0045/index.ts#L119](../plugins/xep0045/index.ts#L119)、[xep0084/index.ts#L76](../plugins/xep0084/index.ts#L76)、[xep0128/index.ts#L12](../plugins/xep0128/index.ts#L12)、[xep0172/index.ts#L44](../plugins/xep0172/index.ts#L44) 等（先收集全部结果再取 `[0]`）。

2026-10-11 复核实测（root 带 `xmlns`，单链链长 n）：

| n | hit（localName 匹配） | miss（localName 不匹配） |
| - | --------------------- | ------------------------ |
| 250 | 0.43ms | 0.42ms |
| 500 | 1.60ms | 1.69ms |
| 1000 | 6.07ms | 5.80ms |

- n ×4 → 耗时 ×14（平方成分主导）；miss 与 hit 同价 → localName 不匹配的节点同样做了 NS 上溯
- 附带健壮性：深链 4000 在冷启动（未预热）下抛 `RangeError: Maximum call stack size exceeded`（`traverse` 与 `_findNS` 均为递归；2000 层通过，8000/16000 亦溢出）

修法：按成本从低到高——(1) 先比 `localName`，仅对名称匹配的元素解析命名空间（1-2 行，跳过大量无关节点）；(2) 只需第一项的调用方避免先收集全部结果；(3) 可选：`_findNS`/`traverse` 改迭代，顺带消除深链栈溢出。**不建议**直接加永久命名空间缓存：节点移动、祖先增删 `xmlns` 都会使结果失效，失效处理复杂。

### P12. 跨块 remainder 每次重拼：`indexOf` 触发 ConsString 扁平化

位置：[LtxParser.ts#L106-L111](LtxParser.ts#L106-L111)（`currentData = this.remainder + currentData`）、[#L323-L326](LtxParser.ts#L323-L326)（写回 `remainder = currentData.slice(recordStart)`）

长文本跨多个小块、块内始终没有 `<` 时，remainder 逐块累积：每次 write 把整个旧 remainder 与新块拼成 ConsString，随后 fast-path 的 `indexOf` 需要扁平化接收者 → 复制累计内容（`slice(0)` 返回原串、不复制；但每次拼接都产生新的未扁平 ConsString）。总复制量 ∝ N²/块长，块越小越慢。

2026-10-11 复核实测（1MB 纯文本 `x`、无 `<`；min/3）：

| 写入方式 | 耗时 |
| -------- | ---- |
| 单块 1MB | 0.03ms |
| 16KB 分块（64 次） | 13.82ms |
| 4KB 分块（256 次） | 54.96ms |
| 1KB 分块（1024 次） | 222.63ms |

16KB→4KB→1KB 耗时比 ≈ 1 : 4 : 16，恰合 O(N²/块长)，非固定开销所致。注：P1 的 TEXT `break scan` 已让单块 O(n)，分块场景下 `pos` 跳过旧 remainder、`indexOf` 只扫新块，慢的是拼接后的扁平化。

修法：先确认目标场景的块尺寸（socket/TLS 读块通常 16KB 级，退化有限；小块分片会放大）。若需修：改为"只扫增量、分段暂存、token 完成时统一合并"，保持跨块实体还原（`unescapeXML`）与 `text` 事件语义不变（事件仍只在完整文本确定后发出）。顺带：解析路径目前没有单 stanza / 深度 / 未完成 token 长度上限（[Parser.ts#L65-L78](Parser.ts#L65-L78)），可按需为未完成 token 长度设可配置上限（而非限制长连接累计流量）。

## 低

### P7. `append()` 相邻文本节点不合并（非缺陷，可选优化）

位置：[Element.ts#L393-L401](Element.ts#L393-L401)（push 字符串不合并）、消费方 [#L214](Element.ts#L214)（`textContent`）、[#L409-L457](Element.ts#L409-L457)（`toXMLString`）

多段文本（两段文本之间只隔着注释/处理指令/CDATA 时）会形成相邻 string 子节点，`textContent`/`toXMLString` 每次全量遍历 + 转义。

产生条件（实测；`emit("text")` 仅三处 [LtxParser.ts#L171](LtxParser.ts#L171)、[#L187](LtxParser.ts#L187)、[#L328](LtxParser.ts#L328)，`append(str)` 唯一调用点 [Parser.ts#L119](Parser.ts#L119)）：

| 输入 | 结果 `childNodes` |
| ---- | ----------------- |
| `<m>abc</m>` | `["abc"]`（1 个，普通 stanza 不触发） |
| `<m>abc<!--x-->def</m>` | `["abc","def"]`（相邻 string） |
| `<m>abc<?pi?>def</m>` | `["abc","def"]`（相邻 string） |
| `<m>abc<![CDATA[d]]>e</m>` | `["abc","d"]`（`e` 因 CDATA 退出未补 `recordStart` 而丢，见 P2） |
| `<m>abc<b/>def</m>` | `["abc",<b>,"def"]`（中间有元素，不相邻） |
| `<m>abc` + `def</m>`（跨 write） | `["abcdef"]`（remainder 已合并，不产生碎片） |

即：只有"注释/指令/CDATA 夹在文本之间"或调用方多次 `append` 才会触发，下方倍率为上界值。其中 CDATA 夹文本是合法场景；注释/指令属 §11.1 prohibited 但被普遍容忍（现实性见 P2）。实测数据（10KB 内容、1000 碎片 vs 单串，min/5 轮）：

| 操作               | 单节点             | 1000 碎片           | 倍率 |
| ------------------ | ------------------ | ------------------- | ---- |
| `textContent` ×200 | 0.02ms（0.1μs/次） | 0.78ms（3.9μs/次）  | 39×  |
| `toXMLString` ×200 | 1.04ms（5.2μs/次） | 21.56ms（108μs/次） | 20×  |

触发场景：含 CDATA/注释夹在文本间的载荷、调用方多次 `append`。

定性：不合并与 DOM 语义一致（真 DOM 中连续 Text 节点也不自动合并，需 `normalize()`），且单次成本 μs 级——**不算缺陷**，属可选优化。修复（可选）：`append` 中 lastChild 为 string 且新节点也是 string 时直接 `+=`；副作用是 `childNodes` 分割数变化，[QuerySelector.ts#L131-L132](QuerySelector.ts#L131-L132) 的 `:nth-child`/`:first-child` 类伪类按 `childNodes` 计数，合并会改变其结果（全等选择器不受影响）。

### P13. 兄弟组合符 `+`/`~` 逐候选 `siblings.indexOf(el)` 定位

位置：[QuerySelector.ts#L665](QuerySelector.ts#L665)（`+`）、[#L678](QuerySelector.ts#L678)（`~`）

`matchesSelector` 对每个候选元素调用 `siblings.indexOf(el)` 定位其在 `childNodes` 中的位置；同一父节点 w 个元素被逐个检查时，仅定位即 O(w²)；`~` 还需为每个候选向前扫描兄弟前缀，且不缓存前缀匹配结果。

2026-10-11 复核实测（同一父节点 w 个 `item`，min/3、每次查询重复 5 次后取单次）：

| 选择器 | w=1000 | w=2000 | w=4000 |
| ------ | ------ | ------ | ------ |
| `"item + item"` | 0.417ms | 0.723ms | 2.454ms |
| `"item ~ item"` | 0.367ms | 0.720ms | 2.405ms |
| `"item"`（无组合符对照） | 0.150ms | 0.105ms | 0.208ms |

w ×4 时 `+`/`~` 约 ×5.9、纯 `item` 仅 ×1.4 → 超线性成分确认，量级仍小（毫秒级）。**业务代码中未发现 `+`/`~` 选择器调用**（lib/ 全量正则搜索为空），属"成为热点再改"项：可在单次查询内建立"前一个元素兄弟"关系，`~` 还需复用前缀匹配结果（只优化 `indexOf` 不足以消除全部重复扫描）。

### P4. 解析建树的固定分配（基线数据）

位置：[LtxParser.ts#L176](LtxParser.ts#L176)、[#L259](LtxParser.ts#L259)（每标签一个 `attrs = {}`）、[#L77-L93](LtxParser.ts#L77-L93)（每标签 1-2 次 `emit`）、[Element.ts#L54](Element.ts#L54)（`Object.create(null)`）、[#L152-L165](Element.ts#L152-L165)（`_applyAttrs`）

实测（min/3 轮）：

| 项                            | 成本                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `createElement` 空元素 ×20 万 | 208ns/个（41.6ms）                                        |
| 同上 +4 属性                  | 412ns/个（82.5ms，每属性约 +50ns）                        |
| `Object.create(null)` ×100 万 | 132ns/个                                                  |
| `{}` ×100 万                  | 83ns/个（OCN 代价约 +48ns/个，防 `__proto__` 污染所必需） |
| `EventEmitter.emit` ×100 万   | 25ns/次（直接调用 7.4ns）                                 |

均为纳秒级，1000 元素 stanza 的分配开合约 0.4ms；`setAttribute` 内 `String(name)`/`String(val)`（[Element.ts#L185-L190](Element.ts#L185-L190)）对已定类型冗余，可删。另：两处 `attrs` 初始化（[L176](LtxParser.ts#L176) 遇 `<`、[L259](LtxParser.ts#L259) 遇 `>`）中，L259 新建的对象必然在下一次遇 `<` 时被 L176 覆盖、从未被填充，属冗余初始化；但不建议改用"复用已交给 `emit` 监听器的对象"的方式节省分配（外部监听器可能持有引用）。无需专项修复。

### P5. `namespaceURI` 每次上溯父链、无缓存

位置：[Element.ts#L98-L105](Element.ts#L98-L105)、[#L107-L126](Element.ts#L107-L126)（`_findNS` 递归 + 拼 `"xmlns:"+prefix`）；消费点 [connection.ts#L622-L626](../connection.ts#L622-L626)（分发时对每个子元素读取）

实测（min/3 轮）：`namespaceURI` 40ns/次（10 万次 4.0ms），同树 `tagName` 对照 2ns/次（0.2ms）；1000 元素全树 `getElementsByTagNameNS` 0.275ms/次。量级小；若将来分发路径热化，可在元素上懒缓存 NS 解析结果（注意 M6：节点移动会使结果失效，需随 `parentNode` 变更清缓存）。

### P6. `querySelector` 匹配阶段逐候选分配

位置：[QuerySelector.ts#L599](QuerySelector.ts#L599)（每候选 `new Set(classAttr.split(/\s+/))`）、[#L617](QuerySelector.ts#L617)（`[attr~=]` 同样 split）、[#L665](QuerySelector.ts#L665)/[#L678](QuerySelector.ts#L678)（`siblings.indexOf(el)`）

实测（1000 元素树，min/5 轮）：`.class` 选择 0.162ms/次 vs 纯标签选择 0.049ms/次（3.3×，差值即 split+Set 分配）；选择器文本解析本身有 Map 缓存（[#L41-L108](QuerySelector.ts#L41-L108)），不受影响。修复：class Set 懒缓存到元素属性（或 WeakMap）。

### P8. `escapeXML*` 正则与实体回调开销

位置：[escape.ts#L69-L71](escape.ts#L69-L71)、[#L105-L108](escape.ts#L105-L108)（函数体内正则字面量逐次创建）、[#L76-L102](escape.ts#L76-L102)（`unescapeXML` 逐实体 `slice`+拼接）

实测 1MB 数据（min/5 轮）：

| 场景                                       | 耗时    | 吞吐     |
| ------------------------------------------ | ------- | -------- |
| `escapeXML` 纯 `a`                         | 0.54ms  | 1884MB/s |
| `escapeXML` 特殊字符密集（每 7 字符 5 个） | 62.20ms | 16MB/s   |
| `unescapeXML` 无 `&`（shortcut）           | 0.03ms  | ~40GB/s  |
| `unescapeXML` 每 10 字符一实体             | 18.42ms | 56MB/s   |

普通正文无感；正文特殊字符密集时 16MB/s（64KB 正文约 4ms）。L3 提到的拼串 O(n²) 被 V8 rope 字符串吸收，未见明显劣化，主成本是逐字符回调。修复：正则提为模块级常量（2 行）；`escapeXMLReplace` 查表已是最优形态。

---

## 复核基准（2026-10-11）

- 脚本：[test/ltx/_temp_copilot_perf_verify.test.ts](../../test/ltx/_temp_copilot_perf_verify.test.ts)（V1-V5：单块退化/分块/`:scope`/深链/兄弟）、[_temp_copilot_perf_verify2.test.ts](../../test/ltx/_temp_copilot_perf_verify2.test.ts)（S 栈边界、V6 分块退化）；Vitest 运行、多轮取最小值，环境与文首一致。终端沙箱不可用时经测试失败消息回显取数（脚本内 `throw new Error(…)` 输出度量）。
- 结论：P1 的 TEXT 修复有效（对照 0.00ms）；ATTR_VALUE/COMMENT/CDATA 当时未修（P9 成立，2026-10-12 已修）；`:scope >` 全树遍历成立（P10）；NS 先算后比 + 深链栈溢出成立（P11）；remainder 拼接证实为 O(N²/块长)（P12）；兄弟组合符超线性成立、业务无调用（P13）；P3 惰性化成立（已修复）；"上游对照"段的 `insertBefore` 解释已更正。
- 数据详表见 P9-P13 各条；脚本建议并入 [perf.test.ts](../../test/ltx/perf.test.ts) 后删除临时文件。

**2026-10-12 修复后复测**（P1/P9 落地后）：

- 一次性临时脚本 `test/ltx/_temp_copilot_perf_p9.test.ts`（五态单块/分块 + 跨块 `]]>` 用例）测得单块 16KB~128KB 均 ≤0.01ms，已删除；其内容并入 [perf.test.ts](../../test/ltx/perf.test.ts) 的 P9 段（`text` / `attr-value` / `cdata` / `cdata-tail`）与 P2 段的 `open-comment` 行，数据即 P9 表格
- `npx vitest run test/ltx` 全绿；`npm run ts-check`、`npx eslint lib/ltx/LtxParser.ts test/ltx/perf.test.ts` 通过
- 语义未变：只改"落空后如何推进扫描"，事件流与修复前一致；跨块 `]]>` 识别（块尾 `]`/`]]`）经用例复核仍正常

## 建议修复顺序（2026-10-12）

1. ~~**P9**（ATTR_VALUE/COMMENT/CDATA 三处 `break scan` + CDATA 的 `parseRemainder` 前置）~~ **已修复**：与 TEXT 同一机理，单块 128KB 由 ~215ms 降至 0.01ms
2. **P10**（`:scope > 单复合选择器` 直接遍历 childNodes）：约 30× 余量，解析侧调用广；注意 `:scope > a b`、混合逗号不可套用
3. **P11**（先比 localName 再算 NS，1-2 行；可选递归改迭代）：消除无关节点上溯与深链栈溢出
4. **P12**（跨块 remainder 增量扫描/分段合并）：1MB 分 1KB 块 222.63ms；保持跨块实体还原与 `text` 事件语义
5. **P2**（吞数据缺陷、`]]>` 后文本、跨块 `-->`/`?>` 重建，即本次未补的 COMMENT/指令态跨块结束符识别）：先定"容忍策略"还是"`<restricted-xml/>` 严格策略"
6. （设计项）输入资源上限：单 stanza 大小 / 深度 / 未完成 token 长度设为可配置上限（当前无任何限制，见 P12 末段），属策略决定，与缺陷修复解耦
7. P13（兄弟组合符）、P7（append 合并，非缺陷/可选）：有触发场景/热点再改；P3 已修复；P4/P5/P6/P8：有触发场景再改

## 附：基准原始输出（2026-10-06）

```text
[env] node v22.23.2 / 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz / win32
[P1] plain 16KB single-write: 3.65ms
[P1] plain 32KB single-write: 13.73ms
[P1] plain 64KB single-write: 50.93ms
[P1] plain 128KB single-write: 206.88ms
[P1] plain 16KB 16KB-chunks: 3.64ms
[P1] plain 32KB 16KB-chunks: 7.42ms
[P1] plain 64KB 16KB-chunks: 14.47ms
[P1] plain 128KB 16KB-chunks: 28.02ms
[P1] tagged 16KB single-write: 0.03ms
[P1] tagged 32KB single-write: 0.06ms
[P1] tagged 64KB single-write: 0.11ms
[P1] tagged 128KB single-write: 0.22ms
[P2] comment split -> trees=[]
[P2] pi split -> trees=[]
[P2] cdata split -> trees=[m]
[P2] open-comment 16KB single-write: 4.60ms
[P2] open-comment 32KB single-write: 14.05ms
[P2] open-comment 64KB single-write: 52.01ms
[P2] open-comment 128KB single-write: 214.74ms
[P3] small stanza: 0.99us/次 (19.8ms/20000)
[P3] big stanza(50子元素): 32.8us/次 (163.9ms/5000)
[P3] 换算白烧: 100 stanza/s -> small 0.10ms/s, big 3.3ms/s
[P4] createElement x200000: 空 41.6ms (208ns/个)
[P4] createElement x200000: 4属性 82.5ms (412ns/个)
[P4] 100 万次分配: Object.create(null) 131.9ms, {} 83.4ms
[P4] 100 万次: emit 24.8ms (25ns/次), 直接调用 7.4ms
[P5] namespaceURI x100000: 4.0ms (40ns/次)；tagName 对照 0.2ms
[P5] getElementsByTagNameNS 全树(1000 元素): 0.275ms/次
[P6] querySelectorAll 1000 元素 x50: ".item" 8.1ms vs "item" 2.5ms
[P6] 单次: 0.162ms vs 0.049ms
[P7] textContent x200 (10KB): 单节点 0.02ms vs 1000 节点 0.78ms
[P7] toXMLString x200: 单节点 1.04ms vs 1000 节点 21.56ms
[P8] escapeXML plain 1MB: 0.54ms (1884 MB/s)
[P8] escapeXML special 1MB: 62.20ms (16 MB/s)
[P8] unescapeXML plain(shortcut) 1MB: 0.03ms (40797 MB/s)
[P8] unescapeXML entities 1MB: 18.42ms (56 MB/s)
```

---

## 逐 API 基线（2026-10-14，含上游对照）

基准文件：[test/ltx/bench.test.ts](../../test/ltx/bench.test.ts)。

```
npx vitest run test/ltx/bench.test.ts --disable-console-intercept                            # 轻量档
$env:LTX_BENCH="full"; npx vitest run test/ltx/bench.test.ts --disable-console-intercept     # 完整档（下表数据）
```

方法：同一文件内同时加载本项目（`lib/ltx/*.ts`）与上游（`ltx-main/src/*.js`），同 harness 内 **A/B 交替轮次**（奇偶轮互换执行顺序），各取自身最小值换算 ns/op；上游无对应 API 的项只报绝对值（`solo`）。环境：node v22.23.2 / i5-11400H / win32。完整档：目标单轮 20ms、9 轮（下表 CV 多为 1%~5%）。

> **读数口径**：这只是**一个混合负载文件**里的单次运行。同一 API 在"精简负载文件"里的比值可能不同（见文末「与早先测量的差异」）。判断某项改动的效果，必须在**同一文件内**跑 A/B——绝对值与比值都会随 JIT/IC 状态和前面的用例漂移。

### 表 A · 有上游对照（按 ts/up 从慢到快）

| 用例 | 上游 | 本项目 | ts/up | 说明 |
| --- | ---: | ---: | ---: | --- |
| querySelector 直接子 / `getChild` | 36.8 ns | **873.2 ns** | **23.72×** | 选择器引擎固有成本 + 文档序重排遍历 |
| 集合下标 `coll[0]` / 数组下标 | 8.0 ns | **173.4 ns** | **21.80×** | `XMPPElementCollection` 的 Proxy 陷阱 |
| 集合 `length` / 数组 `length` | 3.5 ns | 20.5 ns | 5.93× | 同上 |
| `setAttribute` 覆盖 / `attr()` | 3.5 ns | 20.8 ns | 5.93× | `_ensureAttrs` 判定 + 两次 `String()` |
| 宽树 `getElementsByTagName` / `getChildrenByFilter` | 338.3 ns | 1 166.1 ns | 3.45× | 递归全树 + 每次构造集合 |
| `createElement` 4 属性 / `new Element` | 71.7 ns | 210.1 ns | 2.93× | null-proto 逐键写入（安全设计的固有代价） |
| 创建+挂载 / 上游 `c()` | 97.6 ns | 262.8 ns | 2.69× | 上一行 + `appendChild` |
| 集合迭代 / 数组 `for-of` | 51.4 ns | 131.8 ns | 2.56× | 迭代器走 Proxy |
| 集合 `forEach` / 数组 `forEach` | 79.6 ns | 173.8 ns | 2.18× | 同上 |
| `getAttribute` 命中 / `getAttr` | 7.3 ns | 15.1 ns | 2.05× | `String(name)` + `?? null` |
| `namespaceURI` 深度 21 / `getNS` | 136.2 ns | 270.4 ns | 1.99× | 递归 + 每层 `prefix` 的 `indexOf`+`slice` |
| `removeAttribute` / `delete attrs[k]` | 57.2 ns | 96.4 ns | 1.69× | `in` 探测 + `_ensureAttrs` |
| 全树按名查找 / `getChildren()` | 732.3 ns | 1 233.5 ns | 1.68× | |
| `write(writer)` 单条 | 1 207.8 ns | 1 903.6 ns | 1.58× | |
| Buffer 输入 单条 | 2 711.2 ns | 4 245.0 ns | 1.57× | 本项目走流式 `TextDecoder`，上游先 `toString()` |
| `append` 文本 / `t()` | 23.4 ns | 36.5 ns | 1.56× | |
| `namespaceURI` 深度 5 / `getNS` | 15.4 ns | 23.6 ns | 1.54× | |
| `toString` / `toXMLString` 单条 | 1 548.6 ns | 2 319.0 ns | 1.50× | 每层模板串拼接 + 父层 `+=` |
| 序列化 宽元素(50 子) | 17 708.9 ns | 31 962.9 ns | 1.81× | |
| `new SaxLtx` / `new LtxParser` | 60.3 ns | 79.0 ns | 1.31× | 构造含 `TextDecoder` 与 `write` 绑定 |
| SAX 单条 | 2 447.6 ns | 2 881.2 ns | 1.18× | |
| 60 条会话流 16KB 分块 SAX | 146 464.6 ns | 170 790.6 ns | 1.17× | |
| 60 条会话流 16KB 分块 建树 | 173 081.2 ns | 199 915.6 ns | 1.16× | |
| 建树 单条 / `parse` | 3 587.1 ns | 3 959.5 ns | 1.10× | |
| `getAttribute` 缺失 | 11.4 ns | 12.5 ns | 1.10× | |
| `unescapeXMLText` 数字实体 | 717.2 ns | 780.7 ns | 1.09× | 多一次数字实体正则校验 |
| 子节点数 / `children.length` | 3.4 ns | 3.4 ns | 1.02× | |
| `new Parser` / `new UpParser` | 371.5 ns | 376.1 ns | 1.01× | |
| `escapeXML` 含特殊字符 | 1 496.4 ns | 1 498.8 ns | 1.00× | |
| `escapeXMLText` 普通文本 | 150.5 ns | 149.4 ns | 0.99× | |
| `unescapeXML` 无实体（短路） | 26.3 ns | 25.6 ns | 0.97× | |
| `escapeXML` 普通属性值 | 102.8 ns | 97.8 ns | 0.95× | |
| `localName` / `getName` | 15.8 ns | 14.7 ns | 0.93× | |
| `unescapeXML` 命名实体 | 1 194.0 ns | 1 107.4 ns | 0.93× | |
| `textContent` 读 / `getText` | 10.1 ns | 9.4 ns | 0.93× | |
| `createElement` 无属性 | 22.2 ns | 20.3 ns | 0.92× | 共享冻结空表 |
| `appendChild` / `cnode` | 51.8 ns | 44.9 ns | 0.87× | |
| `removeChild`+复原 / `remove`+复原 | 40.6 ns | 31.0 ns | 0.76× | |
| `textContent` 写（替换） | 58.8 ns | 14.4 ns | **0.25×** | 上游要先清空 `children` 再 `t()` |

### 表 B · 上游无对应 API（绝对值）

| 用例 | 本项目 |
| --- | ---: |
| `createElementNS` 无属性 | 50.4 ns |
| `createElementNS` 4 属性 | 251.6 ns |
| `tagName` | 3.8 ns |
| `prefix` 无前缀 / 带前缀 | 11.0 ns / 85.1 ns |
| `childNodes` getter | 3.4 ns |
| `children` getter（集合构造） | 76.3 ns |
| `firstElementChild` / `lastElementChild` | 5.6 ns / 5.3 ns |
| `childElementCount` | 6.7 ns |
| `previousElementSibling` / `nextElementSibling` | 7.4 ns / 11.9 ns |
| `parentNode` / `parentElement` | 4.0 ns / 4.0 ns |
| `contains` | 5.0 ns |
| `insertBefore`（插入+移除） | 78.0 ns |
| `remove` 自身 | 48.6 ns |
| `matches` | 58.9 ns |
| `getElementsByTagNameNS`（50 元素树） | **9 008.1 ns** |
| `querySelectorAll`（50 元素树） | **23 671.4 ns** |
| `toXMLString(2)` 缩进 | 2 310.6 ns（与无缩进 2 319.0 ns 基本持平） |
| `Parser.reset()` | 4 226.0 ns |
| 集合 `item(0)` | 80.0 ns |
| 解析产物首次 `setAttribute`（COW 复制冻结表） | **1 554.9 ns** |

### 判读

- **最该动的仍是查询与集合**：`querySelector(":scope > x")` 23.7×、集合下标 21.8×、`getElementsByTagNameNS` 9.0 µs（50 元素树，每元素都要算一次 `namespaceURI`）、`querySelectorAll` 23.7 µs。这些是插件解析 stanza 时的实际路径（`xep0030/0004/0054/0060/0199` 都在用 `:scope > …`）。
- **`setAttribute` 5.93× 与 COW 1 554.9 ns 同源**：COW 复制目前仍用 `Object.assign` 复制 null-proto 的 dictionary 表，实测 1 421 ns（同长度的 `for…in` 复制为 398 ns，见 2026-10-13 的一次性基准）。`_ensureAttrs` 的 `EMPTY_ATTRS` 快路径已落地（`createElement` 4 属性回到 210 ns，与改动前的 204.6 ns 持平），但复制方式这半边还没换。
- **`createElement` 4 属性 2.93×** 是 null-proto 逐键写入的固有代价（安全设计换取 `__proto__`/`constructor` 属性名安全），解析路径已通过"接管 SAX 产出的冻结表"绕过，**构造路径（出站）仍付这笔钱**。
- **序列化 1.5×~1.8×**：`toXMLString` 每层返回新串、父层再 `+=`；`write(writer)` 与它同量级（1 903.6 ns）。缩进版本与无缩进版本耗时持平，说明 `every()` 预扫描不是瓶颈。

### 与早先测量的差异（重要）

同一批 API 的比值在**不同基准文件**里会明显不同，例：

| 用例 | 精简负载文件（2026-10-13） | 本文件（2026-10-14） |
| --- | ---: | ---: |
| SAX 单条 | 1.10×（本项目更快） | 1.18×（本项目更慢） |
| 建树 单条 | 0.81×~0.91× | 1.10× |
| 序列化 单条 | 0.66× | 1.50× |

两次用的是同一条语料形态、同一个上游实现。差异只能归因于**测量上下文**：本文件在同一进程里连续跑了 50+ 个 API（持续的分配与 GC、`LtxParser`/`Parser` 被用作 fixture 反复解析、各访问点 inline cache 状态不同）。这也正是"抓某个改动的效果必须同文件 A/B"的原因——本节数据用于**横向看哪个 API 值得优化**，不用于纵向比较版本。

### 待办（按收益排序）

1. **`localName` 缓存**：每次 `indexOf(":")` 加可能的 `slice`，`matchesItem` 对每个候选元素都要读一次。同文件实测 50 元素 430.8 → 51.5 ns（8.4×）；`tagName` 是 `readonly`，构造期算好即可。
2. **查询**：① `querySelectorAll` 在单组且无兄弟组合符时免去文档序重排（现在无论命中多少都要再遍历整棵树一遍）；② 为"取直接子元素"提供不经过选择器引擎的入口（插件的 `:scope > x` 全部可换）。
3. **集合**：`XMPPElementCollection` 的下标与 `length` 走 Proxy 陷阱（21.8×/5.9×），考虑改成真实数组 + `item()` 挂载。注意 happy-dom 的 `NodeList` 同样用 Proxy，且 handler 里还多一次 `methodBinder.bind`——这是"带索引的类数组视图"的固有代价，不是实现疏漏。
4. **`getElementsByTagNameNS`**：每个元素独立读 `namespaceURI` 并向祖先回溯（50 元素树 9.0 µs，比 `getElementsByTagName` 贵 8×），遍历时自上而下传递命名空间上下文即可。
5. **COW 复制**：`_ensureAttrs` 的复制从 `Object.assign` 换成 `for…in`（null 原型 + 冻结表上实测 1 141 → 376 ns，2.9×）。
6. **序列化**：`write(writer)` 的逐属性 5 次回调可合并；`toXMLString` 仍是逐层返回新串再 `+=`。
7. **结果缓存**：happy-dom 式 per-node 查询结果缓存（先量插件对同一 stanza 的重复查询频率再定）。
8. **`_findNS` 迭代化**：实测 0.66×（深度 21：263 → 174 ns），顺带修 `xmlns:foo=""` 被真值判断误当"未声明"的小 bug。
9. **类选择器的 class token 缓存**：`matchesItem` 里 `classAttr.split(/\s+/)` 对每个候选元素 × 每个选择器组各执行一次（`querySelectorAll(".a")` 在 5000 元素文档上就是 5000 次 `split` 外加正则）。参照 happy-dom 在元素上惰性缓存解析好的 token 集合（等价于 `classList.contains`），并在 `setAttribute("class", …)`/`removeAttribute("class")` 时置空缓存。XMPP 场景几乎不用类选择器，优先级低于前 8 条。

### 已落地（2026-10-13 ~ 10-14，均为同文件 A/B）

| 改动 | 位置 | 实测 |
| --- | --- | --- |
| 属性表所有权转移（接管 SAX 产出的冻结表） | `LtxParser` + `Parser` + `Element` | 元素构造 4 属性 371.9 → 52.9 ns（0.142）；建树 depth-21 × 4 属性 8 378.0 → 1 483.8 ns（0.177） |
| 无属性元素共享冻结空表（`EMPTY_ATTRS` 快路径） | `_ensureAttrs` | `createElement` 无属性回到 210 ns，与改动前的 204.6 ns 持平 |
| `toXMLString` 的 `every()` 移入缩进分支 | `Element.ts` | `toXMLString()` 无缩进（101 元素）34 634.4 → 33 222.1 ns（−4.1%） |
| `findAll` 直访 `childNodes`，`itemIndex` 取代 `items.slice` | `QuerySelector.ts` | `querySelectorAll("item")`（101 元素）24 525.7 → 9 345.7 ns（−62%）；`querySelector(":scope > body")` 959.8 → 344.6 ns（−64%） |
| `appendChild` 末尾追加改 `push` | `insertBefore` | 27.1~30.2 → 18.0~18.7 ns（−35%~−38%） |


## 迁入：原 REVIEW.md 的性能专项（2026-10-12 / 10-13；该文件已删除）

> 本节承接原 `REVIEW.md` 的 §0 性能段落、§4.9 剪枝方案与 §5 性能专项。**口径提醒**：下面"跨进程对照"是 TS 版与 JS 版**分进程**跑出来的（避免内联缓存互相污染），与上文「逐 API 基线（2026-10-14）」的同 harness 口径不同，绝对值不可混比。

### 跨进程对照：TS 版 vs JS 版（2026-10-12，Node v24 / win-x64）

方法：同一份用例脚本分别在两个进程里跑；预热 300 ms、每样本预算 60 ms、15 个样本取中位数。

| 用例 | ts/ltx | src/（JS） | 比值 | 判读 |
|---|---:|---:|---:|---|
| SAX·64 KB 纯文本·一次 write | 1.74 | 1.69 | 1.03× | 持平 |
| SAX·64 KB 纯文本·分 5 次 write | 15.44 | 15.66 | 0.99× | 持平 |
| SAX·64 KB 未闭合 CDATA | **1.81** | 323.51 | **0.006×** | 修掉了 JS 版 O(n²) |
| SAX·64 KB 未闭合注释 | **1.78** | 50 129.40 | **0.00004×** | 修掉了 JS 版 O(n²) |
| SAX·5000 个属性 | **852.91** | 1 029.55 | 0.83× | 快 17% |
| SAX·8000 层嵌套 | 1 255.70 | 952.52 | **1.32×** | 慢 32% |
| SAX·16 条真实 XMPP 语料 | 43.58 | 44.78 | 0.97× | 持平 |
| 建树·16 条真实 XMPP 语料 | 69.45 | 55.82 | **1.24×** | 慢 24% |
| 建树·8000 层嵌套 | 2 162.88 | 1 331.44 | **1.63×** | 慢 63% |

补充微基准（同进程，仅作量级参考）：

| 微操作 | 实测 |
|---|---|
| `createElement` ×2 + `appendChild` ×1 | 0.112 µs/op，116 B/op |
| `Object.create(null)` + 3 次赋值 | 0.035 µs |
| `{}` 字面量 + 3 次赋值 | 0.004 µs（8.1× 于上者，**本仓库复测不成立**） |
| `getAttribute()`（1 次） | 8.4 ns |
| `namespaceURI`（祖先链深度 200） | **2.867 µs/次** |

判读：

- **SAX 层已优于 JS 参考实现**（真实语料持平、属性密集更快、两处 O(n²) 被消除）。快路径里的 `indexOf` 跳跃与 `break scan` 应当保留。
- **回归集中在 Element 建树层**：同一语料建树慢 24%，同深度建树慢 63%。嫌疑排序为"每标签 1~2 次 `Object.create(null)`"（**本仓库复测不成立**，见下）、`appendChild → insertBefore` 的额外层次（已落地）、`prefix`/`namespaceURI` 的 getter 开销。
- **`namespaceURI` 是 O(depth) 且每次分配**：深度 200 单次 2.867 µs，`prefix` 每次 `indexOf` + `slice` 产生新字符串；`getElementsByTagNameNS` 因此是 O(n × depth)。
- 其余可选项：`write(writer)` 每个属性 5 次回调；`escapeXML`/`escapeXMLText` 的正则可提到模块级复用。

### 本仓库复测（2026-10-13，node v22 / i5-11400H / win32）

| 项 | 上节的说法 | 本仓库实测 |
|---|---|---|
| `Object.create(null)` vs `{}` | 8× | **1.2×**（217 vs 180 ns / 百万次，差 ~37 ns） |
| `namespaceURI` 单次 | depth 200 = 2.867 µs | depth 1 = 46 ns；depth 200 = 3.5 µs（量级复现） |
| 全树 `getElementsByTagNameNS` | O(n·depth)（推断） | 9 元素 0.010 ms；65 元素 0.070 ms；201 元素链 0.457 ms |
| 一条 4 标签 stanza | — | SAX 3.1 µs；`Parser.parse` 6.7 µs |
| 分层复测（3 元素 stanza，同一文件） | — | SAX 1.31 µs → 加建树处理器 2.12 µs → `Parser.write` 2.22 µs；**建树 ≈ 0.81 µs/条（≈37%），合 271 ns/元素** |
| 单元素 / 单次操作 | createElement 279 ns | `createElement` 无属性 9.5~103 ns、2 属性 70~86 ns、`appendChild` 18~19 ns、`prefix` 16 ns、`emit` 47 ns |

判读：

- **"每标签 1~2 次 `Object.create(null)` 是建树回归主因"不成立**：纯分配只比 `{}` 贵 ~37 ns。分层复测显示非 SAX 开销几乎全在建树，但拆到微操作后没有单项能解释 271 ns/元素——这类绝对值对测量上下文极其敏感、不可跨文件比较。真正能吃下量级的是**属性应用路径**：同文件内 `createElement`（2 属性）70~86 ns vs（无属性）9.5~21 ns。
- **`namespaceURI` 的 O(depth) 只在深树才值钱**：XMPP 报文深度 ≤ 8，一次全树 NS 查询 0.010 ms；201 层的链才掉到 0.457 ms。`prefix` 单次 16 ns，构造期缓存的收益属噪音级。
- **已落地的空表复用**（两处，同文件 A/B）：
  - `LtxParser`：无属性标签共用一张冻结空表，遇到第一个属性值才分配。4 标签 stanza 3.13~3.34 → 2.81~2.83 µs/条（−13%~−15%）。
  - `XMPPElement`：无属性元素共享空表。`createElement`（无属性）161~220 → 103~127 ns（−35%~−50%）；`Parser.parse`（4 标签）4.36~4.54 → 4.26~4.49 µs（−3%）；6 标签全无属性 3.75~3.76 → 3.52~3.81 µs（−3%~−6%）。
- **已落地：`appendChild` 末尾追加改 `push`**：旧 `splice` 27.1~30.2 → 新 `push` 18.0~18.7 ns（−35%~−38%）。
- **已落地：属性表所有权转移**：`LtxParser` 在 emit `startElement` 前 `Object.freeze(attrs)`，`Parser` 改调 `_createElementAdoptingAttrs` 直接接管；元素层以"冻结"作为「这张表不属于本元素」的标记，写属性时写时复制。同文件交替轮次实测 `createElement`（4 属性）753/892 → 315/465 ns（−48%~−58%），3 元素 stanza 的建树部分 1.84~3.98 → 0.60~0.80 µs/条（−67%~−80%）。语义由冻结兜底：`startElement` 监听方拿到只读表，元素后续写走 COW，不会反向改动监听方持有的表。
- **已否决：解析器专用免校验挂载**（跳过自身/环/`NotFoundError`/`removeChild` 判定直接 `push`）。交替轮次 A/B 只省 1.1 ns/次挂载、2.5 ns/元素，对每元素 271 ns 是噪音级，不值得为此新增一个可绕过校验的内部 API。

### 全层 A/B 的语料与方法（2026-10-13）

把两版实现放进**同一个 Vitest 文件、同一个 harness** 逐层 A/B：每个用例先自适应定标迭代数（目标单轮 ~15 ms），再交替轮次采样（奇偶轮互换先后），各取自身最小值换算 ops/sec。**结果表见上文「逐 API 基线（2026-10-14，含上游对照）」**（同方法的更新版本），此处只保留语料定义与归因。

| 名称 | 内容 | 大小 |
|---|---|---|
| `CHAT_MSG` | RFC 6121 §5.2.2 聊天消息 + XEP-0203 `delay` | 312 B |
| `MUC_PRESENCE` | XEP-0045 §7.2.2 自身出席（`x`/`item`/`status`） | ≈300 B |
| `ROSTER` | RFC 6121 §2.1.3 roster 结果（4 个 `item`） | 477 B |
| `LONG_MSG` | 长正文消息 | ≈1.9 KB |
| `SESSION` | 流头 + 15×上述四条 + 流尾 | 47 333 B |

分片按 1 KB / 4 KB / 8 KB / 16 KB 切块 `write()`，模拟 socket 读块（TLS 记录 16 KB、明文读块可能更小）。

归因（**已被后续改动覆盖的部分已标出**）：

1. **属性表是建树层唯一的大杠杆**：`Object.assign({}, attrs)` 51 ns vs `Object.assign(Object.create(null), attrs)` 145 ns；`Object.keys` 循环写入 `{}` 84 ns vs 写入 null-proto 173 ns。即 null-proto 写入 ≈ +23 ns/属性，`Object.keys` 循环相对 `Object.assign` ≈ +30 ns/次。**已由属性表所有权转移消除**。
2. **同一条属性数据在解析路径上被写两遍**（`LtxParser` 建表 → `_applyAttrs` 再建一张）。**已消除**。
3. **建树层多出的 0.81 µs/条**中，属性约占 0.30 µs（8 个属性 × 37 ns），其余为 XMPP 语义带来的 `startElement`/`endElement` 透传 `emit`（上游 `Parser` 不转发）与 `streamRoot`/`stream:stream` 判定。
4. **查询 API 是调用侧最大开销**：`QuerySelector.parse` 虽有解析缓存，但 `querySelector` 每次仍要 `new Set` + `findAll` + 按文档序重排时对整棵子树的遍历；`getElementsByTagName` 递归全树且每次 `new XMPPElementCollection`（Proxy 包装）。上游 `getChild` 只扫直接子节点，语义更窄因而更快。**`findAll` 的 Proxy 构造部分已消除（见上文已落地表），其余仍在**。
5. **上游未修 fast-path 落空**：分片越小退化越重，这是本项目在 1 KB~8 KB 读块下快 2×~6.5× 的原因。
6. **ns 级数字要谨慎读**：取属性同一操作在三处测出 3.0 / 7.8 / 12.1 ns（inline cache 随元素形状数变化）。表内每行比例可信，跨行绝对值不可直接比较。

### XMPP 场景剪枝方案（原 §4.9，尚未实施）

XMPP 的查询负载有三个特点：**树小且浅**（一条 stanza 通常 10~100 个元素、深度 ≤ 8）、**建成后只读**、**选择器形态高度集中**（绝大多数是"单 tag"、"tag + 属性"、"两层父子"，几乎不用类选择器与兄弟组合符）。据此分四层剪枝。

#### A. 形态剪枝（编译期分派，收益最大）

解析完选择器后判定形态，命中就走专用匹配器——不构造 `SelectorItem`、不进通用回溯：

| 形态 | 例 | 专用实现 |
|---|---|---|
| 单个 tag | `body`、`show` | 直接比 `localName` 的前序扫描，命中即返回 |
| 单 `#id` / `tag#id` | `#x1` | 先比属性 `id`（O(1) 属性查表） |
| 两层父子 / 后代 | `message > body`、`iq query` | 两段正向推进：第一段命中集合 → 只在其次级/子树找第二段 |
| `*` | `*` | 等价"所有元素"，无需匹配 |
| 含 `\|` 前缀 | `stream\|features` | 先按 `localName` 过滤，再验前缀 |

其余复杂形态（伪类、兄弟组合符、多步后代）才落通用引擎。

#### B. 遍历剪枝（运行期）

- **深度上限**：`maxDepth` 默认 64，超过即停止下探。正常 XMPP 报文远小于 64，无副作用，却能挡住深嵌套栈溢出。
- **元素数组缓存**：在元素上惰性缓存"仅元素子节点"的数组（happy-dom 的 `PropertySymbol.elementArray` 就是这个思路）。注意 `findAll` 改为直访 `childNodes` 后已拿到大部分收益，再维护缓存字段的边际收益有限（每元素省一次 `instanceof`）。
- **兄弟轴按需**：只有 `+`/`~` 需要兄弟索引；XMPP 几乎不用，通用引擎里用线性回扫即可。
- **起点即 stanza 根**：第一步 tag 比较就把无关分支剪掉。

#### C. 缓存剪枝（跨调用）

happy-dom 用"per-node 结果缓存 + `affectsCache` 广播失效"，ltx 的等价物可以更省：**版本号失效**。

```ts
export class XMPPElement {
  private _version = 0;                                              // 结构/属性变更时自增
  private _queryCache?: Map<string, { version: number; result: XMPPNodeList }>;

  private _bumpVersion(): void {
    for (let n: XMPPElement | null = this; n; n = n.parentNode) n._version++;   // 沿祖先链冒泡
  }

  public querySelectorAll(selectors: string): XMPPNodeList {
    const cache = (this._queryCache ??= new Map());
    const hit = cache.get(selectors);
    if (hit && hit.version === this._version) return hit.result;      // stanza 只读 → 命中率极高
    const result = new XMPPNodeList(QuerySelector.querySelectorAll(this, selectors));
    if (cache.size >= 8) cache.clear();                              // 每元素最多 8 条，粗粒度但够用
    cache.set(selectors, { version: this._version, result });
    return result;
  }
}
```

两条约束：**(a)** 子树变更必须沿祖先链冒泡（O(depth)，只在写操作时付一次）；**(b)** 若不想碰写路径，也可以只在 `Parser` 产出的"不可变 stanza"上启用缓存。是否值得做取决于插件对同一 stanza 的重复查询频率。

#### D. API 剪枝：热路径不过选择器引擎

两者不是二选一，而是分层：DOM 风格 API（`querySelector`/`querySelectorAll`）负责通用与可读性；XMPP 热路径用只看直接子节点的专用 API（`getChild`/`getChildren`/`getChildText`，JS 版本来就有，TS 版移植时未带上）。同一条 stanza 上 `el.getChild("body")` 只是几次标签比较，`el.querySelector("body")` 要构造集合 + 正向下探 + 走匹配器。

#### E. 防护阈值

`maxDepth`（默认 64）、`maxSteps`（单次匹配预算）、可选 `maxResults`，三者均可覆盖，让深嵌套与选择器复杂度在库内部消解，而不是把防护责任推给调用方。

## 复验结论：以下曾被疑为缺陷，经 RFC 6120 对照**不视为问题**

- 忽略注释/处理指令、不建树：§11.1 将**注释、处理指令、DTD 子集、非预定义实体引用**列为 prohibited（发送方 MUST NOT 注入；接收方收到 SHOULD 回 `<restricted-xml/>` 关流，§11.1 行为规则 2 + §4.9.3.18），本库选择容忍忽略——real-world 互操作更宽松；注意 `<?xml?>` 声明不属该禁列，§11.5 要求流头前 SHOULD 发送
- 流式路径无 DTD/`<!DOCTYPE>`：仅影响 `Parser.parse` 外部文件（M11 单列）
- 顶层元素逐个 emit、流头不建树：§4.1 stanza 语义正确
- 未知命名实体（`&nbsp;`）抛错：§11.1 仅要求预定义实体，合规
- 无 DTD/schema 校验：§11.4 校验可选
- 长空白 keepalive 走 TEXT 路径不受 P2 影响；P1/P9 的四处 fast-path 退化已修复（2026-10-12 复测五态 16KB~128KB 单块均 ≤0.01ms）
