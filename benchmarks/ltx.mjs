/**
 * lib/ltx 逐 API 性能基准：只测本项目实现，给出各 API 的绝对耗时。
 *
 * 运行（直接读 lib/ 源码，无需构建）：
 *   node benchmarks/ltx.mjs                                 # 轻量档
 *   $env:LTX_BENCH="full"; node benchmarks/ltx.mjs          # 完整档
 *
 * 依赖 Node ≥ 22.18（默认开启 TypeScript 类型剥离）。下方注册解析钩子，把 lib 源码里的
 * `x.js` 说明符映射到 `x.ts`、无扩展名说明符补 `.ts` 或 `/index.ts`，因此不需要构建产物，
 * 也不引入 tsx/ts-node 之类的加载器依赖。
 *
 * 方法：
 * - 同一文件、同一 harness；每项自适应定标迭代数，多轮交替取最小值换算 ns/op。
 * - `abInner` 比较本项目两套实现，b/a < 1 表示候选更快。
 * - 绝对值对 inline cache 状态敏感，跨行绝对值仅供量级参考；判读改动效果须在同一文件内做 A/B。
 */
import os from "node:os";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 打印错误并退出 */
function fail(message) {
  console.error(message);
  process.exit(1);
}

if (typeof registerHooks !== "function") {
  fail("当前 Node 不支持 module.registerHooks，需要 Node ≥ 22.18");
}

/**
 * 相对说明符在 TS 源码里的候选路径。
 * @param {string} file 已解析出的绝对路径
 * @returns {string[]} 依次尝试的候选路径
 */
function tsCandidates(file) {
  if (file.endsWith(".js")) return [file.slice(0, -3) + ".ts"];
  return [file + ".ts", join(file, "index.ts")];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative && context.parentURL?.startsWith("file:")) {
      const file = fileURLToPath(new URL(specifier, context.parentURL));
      for (const candidate of tsCandidates(file)) {
        if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { XMPPElement } = await import("../lib/ltx/Element.ts");
const { Parser } = await import("../lib/ltx/Parser.ts");
const { LtxParser } = await import("../lib/ltx/LtxParser.ts");
const { escapeXML, unescapeXML, escapeXMLText, unescapeXMLText } = await import("../lib/ltx/escape.ts");

// ─────────────────────────── 计时 harness ───────────────────────────

const FULL = process.env.LTX_BENCH === "full";
const TARGET_MS = FULL ? 20 : 4;
const ROUNDS = FULL ? 9 : 3;

/** 承接结果，阻止 V8 把纯计算整段消除（DCE） */
let sink;

function measure(fn, iters) {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return performance.now() - t0;
}

function itersFor(fn, targetMs) {
  let iters = 1;
  for (let i = 0; i < 40; i++) {
    const ms = measure(fn, iters);
    if (ms >= targetMs * 0.5 && ms <= targetMs * 2.5) return iters;
    if (ms > targetMs * 2.5) return Math.max(1, Math.round((iters * targetMs) / ms));
    iters = Math.min(
      5_000_000,
      Math.max(iters + 1, Math.ceil(iters * Math.min(32, (targetMs * 0.8) / Math.max(ms, 1e-4)))),
    );
  }
  return iters;
}

function cv(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return m === 0 ? 0 : sd / m;
}

/** 本项目内部 A/B：a 为基线实现、b 为候选实现，b/a < 1 表示候选更快 */
function abInner(title, a, b) {
  const iters = Math.max(1, Math.min(itersFor(a, TARGET_MS), itersFor(b, TARGET_MS)));
  measure(a, iters);
  measure(b, iters);
  const aMs = [];
  const bMs = [];
  for (let r = 0; r < ROUNDS; r++) {
    if (r % 2 === 0) {
      aMs.push(measure(a, iters));
      bMs.push(measure(b, iters));
    } else {
      bMs.push(measure(b, iters));
      aMs.push(measure(a, iters));
    }
  }
  const ns = (ms) => (ms / iters) * 1e6;
  const aNs = ns(Math.min(...aMs));
  const bNs = ns(Math.min(...bMs));
  console.log(
    `[abi] ${title} :: a=${aNs.toFixed(1)}ns :: b=${bNs.toFixed(1)}ns :: b/a=${(bNs / aNs).toFixed(3)} :: cv=${(cv(aMs) * 100).toFixed(1)}/${(cv(bMs) * 100).toFixed(1)}`,
  );
}

/** 单项：只报本项目绝对值 */
function solo(title, fn) {
  const iters = itersFor(fn, TARGET_MS);
  measure(fn, iters);
  const xs = [];
  for (let r = 0; r < ROUNDS; r++) xs.push(measure(fn, iters));
  console.log(
    `[solo] ${title} :: ts=${((Math.min(...xs) / iters) * 1e6).toFixed(1)}ns :: cv=${(cv(xs) * 100).toFixed(1)}`,
  );
}

// ─────────────────────────── 语料 ───────────────────────────

/** RFC 6121 §5.2.2 聊天消息 + XEP-0203 delay（3 元素、5+3 属性） */
const MSG = [
  `<message xmlns="jabber:client" to="juliet@example.com/balcony" from="romeo@example.com/orchard" type="chat" id="aab1a">`,
  `<body>Wherefore art thou, Romeo? I have been waiting since the party ended.</body>`,
  `<delay xmlns="urn:xmpp:delay" from="example.com" stamp="2024-01-01T00:00:00Z">Offline Storage</delay>`,
  `</message>`,
].join("");

/** 宽元素：50 个子元素（查询/序列化的规模项） */
const BIG = `<message xmlns="jabber:client" type="chat">${`<item id="1"><x>hello</x></item>`.repeat(50)}</message>`;

/** depth 层嵌套链，xmlns 只声明在根上 */
function chain(depth) {
  const root = XMPPElement.createElement("root");
  root.setAttribute("xmlns", "urn:test");
  let node = root;
  for (let i = 0; i < depth; i++) {
    const child = XMPPElement.createElement("x");
    node.appendChild(child);
    node = child;
  }
  return node;
}

const ATTRS4 = { to: "juliet@example.com/balcony", from: "romeo@example.com/orchard", type: "chat", id: "aab1a" };
const ATTRS12 = {
  ...ATTRS4,
  "xml:lang": "en",
  nick: "Romeo",
  role: "moderator",
  affiliation: "owner",
  subscription: "both",
  jid: "romeo@example.net",
  name: "Romeo",
  stamp: "2024-01-01T00:00:00Z",
};

/** 解析器交出的表形状：null 原型 + 冻结（复制成本与形状强相关，勿用对象字面量替代） */
function frozenTable(attrs) {
  return Object.freeze(Object.assign(Object.create(null), attrs));
}

/** depth 层嵌套链（每层 4 属性）的 XML 文本，用于建树路径 A/B */
function chainXml(depth) {
  const open = [];
  const close = [];
  for (let i = 0; i < depth; i++) {
    open.push(`<n to="juliet@example.com/balcony" from="romeo@example.com/orchard" type="chat" id="aab1a">`);
    close.unshift(`</n>`);
  }
  return open.join("") + "x" + close.join("");
}

/** 一次性收集 SAX 事件；属性表由解析器产出，两条建树路径共用同一批（只读） */
function collectEvents(data) {
  const events = [];
  const p = new LtxParser();
  p.on("startElement", (name, attrs) => {
    events.push([name, attrs]);
  });
  p.write(data);
  return events;
}

/** 按 SAX 事件建树：adopt=true 走接管路径（当前 Parser），false 走逐键拷贝路径（改动前的 Parser） */
function buildFromEvents(events, adopt) {
  let root;
  const stack = [];
  for (const [name, attrs] of events) {
    const el = adopt
      ? XMPPElement._createElementAdoptingAttrs(name, attrs)
      : XMPPElement.createElement(name, attrs);
    if (stack.length > 0) stack[stack.length - 1].appendChild(el);
    else root = el;
    stack.push(el);
  }
  return root;
}

console.log(`[env] node ${process.version} / ${os.cpus()[0]?.model ?? "unknown"} / mode=${FULL ? "full" : "light"}`);

// ─────────────────────────── 用例 ───────────────────────────

console.log("\n── escape（4 个导出函数）");
{
  const attr = "juliet@example.com/balcony";
  const special = `Tom & Jerry said "let's go" <fast>`.repeat(4);
  const named = "a &amp; b &lt; c &gt; d".repeat(4);
  const plain = "hello world, no entities here".repeat(4);
  solo("escapeXML 普通属性值", () => { sink = escapeXML(attr); });
  solo("escapeXML 含特殊字符", () => { sink = escapeXML(special); });
  solo("escapeXMLText 普通文本", () => { sink = escapeXMLText(plain); });
  solo("escapeXMLText 含特殊字符", () => { sink = escapeXMLText(special); });
  solo("unescapeXML 命名实体", () => { sink = unescapeXML(named); });
  solo("unescapeXML 无实体（短路）", () => { sink = unescapeXML(plain); });
  solo("unescapeXMLText 数字实体", () => { sink = unescapeXMLText("x &#38; y &#60; z"); });
}

console.log("\n── 元素创建");
{
  solo("createElement 无属性", () => { sink = XMPPElement.createElement("message"); });
  solo("createElement 4 属性", () => { sink = XMPPElement.createElement("message", ATTRS4); });
  solo("创建+挂载", () => {
    const p = XMPPElement.createElement("root");
    p.appendChild(XMPPElement.createElement("item", ATTRS4));
    sink = p;
  });
  solo("createElementNS 无属性", () => { sink = XMPPElement.createElementNS("jabber:client", "message"); });
  solo("createElementNS 4 属性", () => { sink = XMPPElement.createElementNS("jabber:client", "message", ATTRS4); });
}

console.log("\n── 属性表所有权（接管 vs 逐键拷贝）");
{
  const empty = frozenTable({});
  const f4 = frozenTable(ATTRS4);
  const f12 = frozenTable(ATTRS12);

  // 改动前的 Parser 走 createElement(name, attrs)，即 _applyAttrs 逐键拷贝
  abInner("元素构造 0 属性：拷贝 vs 接管",
    () => { sink = XMPPElement.createElement("message", empty); },
    () => { sink = XMPPElement._createElementAdoptingAttrs("message", empty); });
  abInner("元素构造 4 属性：拷贝 vs 接管",
    () => { sink = XMPPElement.createElement("message", f4); },
    () => { sink = XMPPElement._createElementAdoptingAttrs("message", f4); });
  abInner("元素构造 12 属性：拷贝 vs 接管",
    () => { sink = XMPPElement.createElement("message", f12); },
    () => { sink = XMPPElement._createElementAdoptingAttrs("message", f12); });

  const events = collectEvents(chainXml(21));
  abInner("建树 depth-21 × 4 属性：拷贝 vs 接管",
    () => { sink = buildFromEvents(events, false); },
    () => { sink = buildFromEvents(events, true); });

  // 冻结表被写入时的复制成本；形状（null 原型）决定 Object.assign 是否走通用慢路径
  const real = events[0][1];
  abInner("复制冻结表 4 键：Object.assign vs for…in",
    () => { const own = Object.create(null); Object.assign(own, real); sink = own; },
    () => { const own = Object.create(null); for (const k in real) own[k] = real[k]; sink = own; });
}

console.log("\n── 属性读写");
{
  const tsMsg = Parser.parse(MSG);
  solo("getAttribute 命中", () => { sink = tsMsg.getAttribute("id"); });
  solo("getAttribute 缺失", () => { sink = tsMsg.getAttribute("nope"); });
  solo("setAttribute 覆盖", () => { tsMsg.setAttribute("id", "9"); });
  solo("removeAttribute + 复原", () => {
    tsMsg.removeAttribute("id");
    tsMsg.setAttribute("id", "1");
  });

  // 解析产物上的首次写：接管来的表是冻结的，这里触发 copy-on-write
  const frozenAttrs = Parser.parse(MSG)._attrs;
  const probe = XMPPElement.createElement("message");
  solo("解析产物首次 setAttribute（COW 复制冻结表）", () => {
    probe._attrs = frozenAttrs;
    probe.setAttribute("x", "1");
  });
  solo("removeAttribute 不存在的键（冻结表短路，不复制）", () => {
    probe._attrs = frozenAttrs;
    probe.removeAttribute("nope");
  });
  solo("setAttribute 首次写（EMPTY_ATTRS 建表）", () => {
    const el = XMPPElement.createElement("message");
    el.setAttribute("k", "v");
  });
}

console.log("\n── 名称与命名空间");
{
  const tsMsg = Parser.parse(MSG);
  const tsDeep = chain(20);

  solo("localName", () => { sink = tsMsg.localName; });
  solo("namespaceURI 深度 5", () => { sink = tsMsg.namespaceURI; });
  solo("namespaceURI 深度 21", () => { sink = tsDeep.namespaceURI; });
  solo("prefix 无前缀", () => { sink = tsMsg.prefix; });
  solo("prefix 带前缀", () => { sink = chain(1).prefix; });
  solo("tagName", () => { sink = tsMsg.tagName; });
}

console.log("\n── 文本与子节点访问");
{
  const tsMsg = Parser.parse(MSG);
  const tsBody = tsMsg.querySelector(":scope > body");
  const tsBare = XMPPElement.createElement("item");
  const tsWide = Parser.parse(BIG);

  solo("textContent 读", () => { sink = tsBody.textContent; });
  solo("textContent 写（替换）", () => {
    tsBody.textContent = "hello";
  });
  solo("childNodes.length", () => { sink = tsMsg.childNodes.length; });
  solo("children getter", () => { sink = tsMsg.children; });
  solo("firstElementChild", () => { sink = tsMsg.firstElementChild; });
  solo("lastElementChild", () => { sink = tsMsg.lastElementChild; });
  solo("childElementCount", () => { sink = tsMsg.childElementCount; });
  solo("previousElementSibling", () => { sink = tsBody.previousElementSibling; });
  solo("nextElementSibling", () => { sink = tsMsg.firstElementChild.nextElementSibling; });
  solo("parentNode", () => { sink = tsBody.parentNode; });
  solo("parentElement", () => { sink = tsBare.parentElement; });
  solo("textContent 读（50 子元素拼接）", () => { sink = tsWide.textContent; });
}

console.log("\n── 树操作");
{
  solo("appendChild", () => {
    const p = XMPPElement.createElement("root");
    p.appendChild(XMPPElement.createElement("item"));
  });

  const tsParent = Parser.parse(MSG);
  const tsChild = tsParent.querySelector(":scope > body");
  solo("removeChild + 复原", () => {
    tsParent.removeChild(tsChild);
    tsParent.appendChild(tsChild);
  });

  solo("append 文本", () => {
    const p = XMPPElement.createElement("a");
    p.append("hello");
  });

  const tsSolo = XMPPElement.createElement("root");
  const tsKid = XMPPElement.createElement("child");
  tsSolo.appendChild(tsKid);
  solo("insertBefore", () => {
    const node = XMPPElement.createElement("x");
    tsSolo.insertBefore(node, tsKid);
    tsSolo.removeChild(node);
  });
  const remParent = XMPPElement.createElement("root");
  const remChild = XMPPElement.createElement("child");
  solo("remove 自身", () => {
    remParent.appendChild(remChild);
    remChild.remove();
  });
  solo("contains", () => { sink = tsParent.contains(tsChild); });
  solo("insertBefore(null) 插入到末尾", () => {
    const p = XMPPElement.createElement("root");
    p.insertBefore(XMPPElement.createElement("x"), null);
  });
}

console.log("\n── 查询");
{
  const tsMsg = Parser.parse(MSG);
  const tsBig = Parser.parse(BIG);
  const tsBody = tsMsg.querySelector(":scope > body");

  solo("宽树 getElementsByTagName(item)", () => { sink = tsBig.getElementsByTagName("item"); });
  solo("getElementsByTagNameNS", () => { sink = tsBig.getElementsByTagNameNS("jabber:client", "item"); });
  solo("querySelector 直接子", () => { sink = tsMsg.querySelector(":scope > body"); });
  solo("querySelectorAll", () => { sink = tsBig.querySelectorAll("item"); });
  solo("matches", () => { sink = tsBody.matches("body"); });
}

console.log("\n── 序列化");
{
  const tsMsg = Parser.parse(MSG);
  const tsBig = Parser.parse(BIG);

  solo("toXMLString 单条", () => { sink = tsMsg.toXMLString(); });
  solo("toXMLString 宽元素(50 子)", () => { sink = tsBig.toXMLString(); });
  solo("write(writer) 单条", () => {
    let n = 0;
    tsMsg.write((chunk) => { n += chunk.length; });
    sink = n;
  });
  solo("toXMLString(2) 缩进序列化", () => { sink = tsMsg.toXMLString(2); });
  const deepXml = chainXml(21);
  const tsDeepXml = Parser.parse(deepXml);
  solo("toXMLString 深树 depth-21", () => { sink = tsDeepXml.toXMLString(); });
}

console.log("\n── 解析");
{
  solo("SAX 单条 LtxParser", () => { new LtxParser().write(MSG); });
  solo("建树 单条 Parser.parse", () => { sink = Parser.parse(MSG); });
  solo("实例化 new Parser", () => { sink = new Parser(); });
  solo("实例化 new LtxParser", () => { sink = new LtxParser(); });

  const session = MSG.repeat(60);
  const chunk = 16 * 1024;
  solo("60 条会话流 16KB 分块 建树", () => {
    const p = new Parser();
    p.on("tree", () => {});
    for (let i = 0; i < session.length; i += chunk) p.write(session.slice(i, i + chunk));
  });
  solo("60 条会话流 16KB 分块 SAX", () => {
    const p = new LtxParser();
    for (let i = 0; i < session.length; i += chunk) p.write(session.slice(i, i + chunk));
  });
  solo("Buffer 输入 单条", () => {
    const buf = Buffer.from(MSG, "utf8");
    new LtxParser().write(buf);
  });
  solo("Parser.reset()", () => {
    const p = new Parser();
    p.write(MSG);
    p.reset();
  });
}

console.log("\n── 集合 API");
{
  const tsBig = Parser.parse(BIG);
  const coll = tsBig.getElementsByTagName("item");
  solo("length", () => { sink = coll.length; });
  solo("下标访问 [0]", () => { sink = coll[0]; });
  solo("for-of 迭代", () => {
    let n = 0;
    for (const el of coll) n += el.tagName.length;
    sink = n;
  });
  solo("forEach", () => {
    let n = 0;
    coll.forEach((el) => { n += el.tagName.length; });
    sink = n;
  });
  solo("item(0)", () => { sink = coll.item(0); });
  // Proxy 陷阱：这几条不经过元素数组本身
  solo("解构展开 [...]", () => { sink = [...coll].length; });
  solo("Object.keys", () => { sink = Object.keys(coll).length; });
  solo("下标 in", () => { sink = 0 in coll; });
  solo("Symbol.toStringTag", () => { sink = Object.prototype.toString.call(coll); });
}

console.log("\n── 选择器（QuerySelector 语法分支）");
{
  const tsBig = Parser.parse(BIG);
  const tsMsg = Parser.parse(MSG);

  abInner("类型 'item'：getElementsByTagName vs querySelectorAll", () => { sink = tsBig.getElementsByTagName("item"); }, () => { sink = tsBig.querySelectorAll("item"); });
  solo("类型全树 querySelectorAll('item')", () => { sink = tsBig.querySelectorAll("item"); });
  solo("属性存在性 '[id]'", () => { sink = tsBig.querySelectorAll("[id]"); });
  solo("通配 getElementsByTagName('*')", () => { sink = tsBig.getElementsByTagName("*"); });
  solo("通配 querySelectorAll('*')", () => { sink = tsBig.querySelectorAll("*"); });
  solo("属性等于 '[id=\"1\"]'", () => { sink = tsBig.querySelectorAll('[id="1"]'); });
  solo("属性前缀 '[id^=\"1\"]'", () => { sink = tsBig.querySelectorAll('[id^="1"]'); });
  solo("子代组合 'item > x'", () => { sink = tsBig.querySelectorAll("item > x"); });
  solo("后代组合 'item x'", () => { sink = tsBig.querySelectorAll("item x"); });
  solo("相邻兄弟 'item + item'", () => { sink = tsBig.querySelectorAll("item + item"); });
  solo("选择器列表 'item, x'", () => { sink = tsBig.querySelectorAll("item, x"); });
  solo("matches 属性 '[type=\"chat\"]'", () => { sink = tsMsg.matches('[type="chat"]'); });
}

console.log(`\n[env] mode=${FULL ? "full" : "light"} target=${TARGET_MS}ms rounds=${ROUNDS}`);
void sink;
