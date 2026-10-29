# XEP-0171 — 语言翻译（langtrans）

发起翻译请求、解析翻译响应，可选地作为翻译机器人（翻译服务提供方）应答请求。

- **依赖**：XEP-0030（`static dependencies` 在注册时自动加载，与角色无关；disco 宣告只在提供方模式用到）
- **实例访问**：`connection.XEP0171`
- **规范版本**：1.1.1（2015-10-15）

> **角色区分**：`urn:xmpp:langtrans` 特性和 `automation/translation` 身份表示该实体**提供**翻译服务，不是“支持显示翻译”。普通聊天客户端默认不声明特性、不响应翻译请求，只使用 `requestTranslation()` / `discoverLanguages()` 发起请求并解析响应。

## 两种角色

| 角色 | 启用方式 | 行为 |
|------|----------|------|
| 客户端（默认） | 无需配置 | 解析消息中的翻译描述；向翻译服务发起请求；查询服务支持的语言对 |
| 提供方（翻译机器人） | 注册时传入 `provider` | 用外部回调翻译 IQ 请求；应答 `langtrans:items` 查询；可宣告 `urn:xmpp:langtrans` |

## 类型定义

### 报文载荷

```typescript
/** <x xmlns='urn:xmpp:langtrans'/> 的解析结果 */
interface LangTransData {
  /** 待翻译原文；仅翻译请求/响应中出现 */
  source?: LangTransSource;
  /** 翻译链；数组顺序即 pivot 顺序 */
  translations: LangTransTranslation[];
}

interface LangTransSource {
  /** 源语言（xs:language / BCP 47）；"und" 表示未确定；空串不合法 */
  lang: string;
  /** 原文 */
  text: string;
}

interface LangTransTranslation {
  /** 目标语言（xs:language / BCP 47），schema 要求必填；空串不合法 */
  destinationLang: string;
  /** 源语言（xs:language / BCP 47）；仅消息投递和服务响应中出现，翻译请求中省略；空串不合法 */
  sourceLang?: string;
  /**
   * 翻译引擎名：省略 = 人工翻译；空串 = 机器翻译但引擎名不可用；
   * 与 reviewed 同时出现 = 机器翻译经人工复核。
   * §4.3 示例里的 engine='default' 只是示例引擎名，不是规范缺省值。
   */
  engine?: string;
  /** 是否经人工复核，缺省 false；构造时可省略 */
  reviewed?: boolean;
  /** 翻译引擎使用的专用词典名称（自由文本） */
  dictionary?: string;
  /** 翻译源文本使用的字符集名称 */
  charset?: string;
  /** 译文；消息投递中的 <translation/> 为空元素，服务响应中才有 */
  text?: string;
}
```

`reviewed` 为 `xs:boolean`，解析时同时接受 `"true"/"1"` 与 `"false"/"0"`（规范附录 G 注 3）。

### 客户端请求

```typescript
/** requestTranslation() 的入参 */
interface LangTransRequest {
  /** 待翻译原文 */
  text: string;
  /**
   * 源语言（xs:language / BCP 47），必填：schema 要求 `<source/>` 的 `xml:lang` 必须存在。
   * 语言未确定时传 `"und"`，由机器人自动识别并在响应中标注识别结果。空串非法。
   */
  sourceLang: string;
  /** 目标语言列表，至少一项 */
  targets: LangTransTarget[];
}

/** 请求中的目标项；按 §4.3.1 不写 source_lang（缺省它是“请求”的标志） */
interface LangTransTarget {
  /** 目标语言（xs:language / BCP 47）；空串不合法 */
  destinationLang: string;
  /** 指定翻译引擎名；省略由服务选择 */
  engine?: string;
  /** 指定翻译引擎的词典名称 */
  dictionary?: string;
  /** 指定源文本字符集 */
  charset?: string;
}
```

### 语言对

```typescript
/** langtrans:items 查询结果中的一项 */
interface LangTransItem {
  /** 源语言（xs:language / BCP 47），schema 要求必填；服务端声明能力时不能为空 */
  sourceLang: string;
  /** 目标语言（xs:language / BCP 47）；items schema 未标 required；提供时不能为空 */
  destinationLang?: string;
  /** 提供该语言对的服务 JID，schema 要求必填 */
  jid: string;
  /** 服务显示名 */
  name?: string;
  /** 翻译引擎名 */
  engine?: string;
  /** 翻译引擎使用的词典名称 */
  dictionary?: string;
  /** 规范未定义语义；只按布尔保留，缺省 false；不要据此推导 pivot 链 */
  pivotable: boolean;
}
```

## 源语言与自动判断

`LangTransRequest.sourceLang` 必填，因为 schema 要求 `<source/>` 必须带 `xml:lang`；语言未确定时传 `"und"`，不要省略字段或传空串（两者都会在 `createTranslationRequestIq` 抛错）。

- **`und` 是 BCP 47 的“语言未确定”标签**，满足 schema 对 `xml:lang` 的必填要求；不要省略该属性。
- XEP-0171 没有规定自动检测语义；服务收到 `und` 后是否自动判断由服务实现决定。
- 提供方模式下，`task.sourceLang` 为请求报文 `xml:lang` 的原值；本插件构造的请求不会省略该属性，语言未确定时就是 `"und"`。

## 语言标签

`destination_lang`、`source_lang` 与 `<source>` 的 `xml:lang` 在 schema 中都是 `xs:language`，不是自由字符串。词法规则（XML Schema Part 2）：

```
^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$
```

- 空串不是合法的 `xs:language`，不能用来表示“自动识别”；语言未确定时用 `und`。
- 校验发生在数据进入插件的位置：本端 API `createTranslationRequestIq` 对 `sourceLang` 与各目标的 `destinationLang` 抛 `Error`；提供方在 `translate` 回调返回后与 `languages` 配置项上校验，不合法时分别回 `internal-server-error`。`createLangTransEl`、`createTranslationEl`、`createItemEl` 只负责生成元素，不校验。
- 这是词法校验，不检查 IANA 语言子标签注册表。
- 入站解析按“对端合规”处理，不在解析阶段拒绝非法标签。

最简单的标签是单个语言子标签，如 `en`、`fr`、`zh`（ISO 639-1 两字母代码）；更具体的可加文字/地区，如 `zh-CN`、`sr-Latn`。`und` 表示语言未确定。

## 发现翻译服务与语言

能力分三层查询：

| 查询 | 用途 |
|------|------|
| 服务器 disco#items（XEP-0030） | 服务器挂载的组件候选列表，如 `connection.XEP0030.getDiscoItems(domain)`；`<item/>` 只有 `jid`/`name`/`node`，没有类型信息 |
| 服务 disco#info（XEP-0030） | 逐个判定候选是否提供翻译：`identity category='automation' type='translation'` 且 feature `urn:xmpp:langtrans` |
| `langtrans:items`（本插件 `discoverLanguages()`） | 具体支持的语言对、引擎、词典、是否可 pivot |

`disco#items` 只是候选池。§4.2.1 要求服务器返回“翻译提供商与语言对”，但 `<item/>` 的属性只有 `jid`、`name`、`node`（XEP-0030 §6）：既没有类型标记，也没有语言字段，`name` 是展示用文本，不能当作判据；服务器还可能返回全部挂载组件（MUC、pubsub、网关等）。因此必须对每个候选做 `disco#info`，用 identity + feature 筛出翻译提供商；语言对只能来自后续的 `langtrans:items`。

`disco#info` 只表示“提供翻译服务”，不列出语言；实际可用的 `sourceLang`/`destinationLang` 以 `langtrans:items` 的结果为准。服务支持的语言可能变化，发起请求前应先查询。

## 扩展字段

```typescript
interface Message {
  /** <x xmlns='urn:xmpp:langtrans'/> 的解析结果 */
  langTrans?: LangTransData;
}

interface Iq {
  /** 翻译请求/响应载荷；提供方模式的入站请求也可从这里读取 */
  langTrans?: LangTransData;
}
```

不派发专门事件。收到带翻译描述的消息时，检查 `message.langTrans`；译文本身在 `message.subjects` / `message.bodies`（按 `xml:lang` 索引）中。

## 公开 API

`XEP0171` 继承工具类 `LangTrans`，下列静态方法在两者上都可用。

| 方法 | 说明 |
|------|------|
| `requestTranslation(service, request)` | 发送 IQ `get`，返回 `Promise<LangTransData>`；参数非法（目标为空、语言标签为空或非法）直接抛 `Error`；错误 IQ 抛 `XMPPError`；响应缺 `<x>` 抛 `Error`；超时/断开由 `sendAsync` 决定（默认 30 秒） |
| `discoverLanguages(service)` | 发送 `<query xmlns='urn:xmpp:langtrans:items'/>`，返回 `Promise<LangTransItem[]>`；错误 IQ 抛 `XMPPError`；响应缺 `<query>` 抛 `Error` |
| `XEP0171.NS.BASE` / `XEP0171.NS.ITEMS`（静态） | `"urn:xmpp:langtrans"` / `"urn:xmpp:langtrans:items"` |
| `XEP0171.parseLangTransEl(el)`（静态） | 解析 `<x>` → `{ langTrans }`（stanza 转换器） |
| `XEP0171.parseItems(el)`（静态） | 解析 items 查询结果 → `LangTransItem[]` |
| `XEP0171.createLangTransEl(data)`（静态） | 构造 `<x>` 元素 |
| `XEP0171.createTranslationEl(t)`（静态） | 构造 `<translation>` 元素 |
| `XEP0171.createTranslationRequestIq(service, request)`（静态） | 构造翻译请求 IQ |
| `XEP0171.createItemsQuery(service)`（静态） | 构造 items 查询 IQ |

## 使用示例

### 发起翻译并读取结果

```typescript
const result = await client.XEP0171!.requestTranslation("translation.example.com", {
  text: "How are you?",
  sourceLang: "en",
  targets: [{ destinationLang: "fr" }, { destinationLang: "de", dictionary: "medical" }],
});

for (const t of result.translations) {
  console.log(t.destinationLang, t.text, t.engine);
}
```

源语言未确定时传 `"und"`，交由机器人判断：

```typescript
await client.XEP0171!.requestTranslation("translation.example.com", {
  text: "How are you?",
  sourceLang: "und",
  targets: [{ destinationLang: "fr" }],
});
```

```xml
<iq type='get' to='translation.example.com'>
  <x xmlns='urn:xmpp:langtrans'>
    <source xml:lang='und'>How are you?</source>
    <translation destination_lang='fr'/>
  </x>
</iq>
```

> 按 §4.3.1，请求中的 `<translation/>` 必须省略 `source_lang`，它的缺失是“这是一个请求”的标志。

### 查询服务支持的语言对

```typescript
const items = await client.XEP0171!.discoverLanguages("translation.example.com");
// [{ sourceLang: "en", destinationLang: "fr", jid: "translation.example.com", engine: "..." }, ...]
```

### 解析收到的翻译消息

```typescript
client.on("message", (message) => {
  if (!message.langTrans) return;
  // 译文正文在 message.bodies[lang]；message.langTrans.translations 给出翻译链
  for (const t of message.langTrans.translations) {
    console.log(t.sourceLang, "→", t.destinationLang, t.engine, t.reviewed);
  }
});
```

### 本端翻译后发送多语言消息

```typescript
const x = XEP0171.createLangTransEl({
  translations: [{ destinationLang: "fr", sourceLang: "en", engine: "MyMT 1.0" }],
});
// 自行构造带 xml:lang 的 <body>/<subject>，附加 <x> 后发送
```

## 提供方（翻译机器人，可选）

### 类型

```typescript
/** provider.translate 的入参，每个目标语言调用一次 */
interface LangTransTask {
  /** 发起请求的完整 JID；插件不校验来源，需要授权时由回调据此拒绝 */
  from: string;
  /** 待翻译原文 */
  text: string;
  /** 请求声明的源语言（xs:language / BCP 47）；"und" 表示未确定，由引擎自行检测 */
  sourceLang: string;
  /** 目标语言（xs:language / BCP 47） */
  destinationLang: string;
  /** 请求指定的词典名称 */
  dictionary?: string;
  /** 请求指定的源文本字符集 */
  charset?: string;
  /** 请求建议的引擎名 */
  engine?: string;
}

/** provider.translate 的返回值：成功为译文描述，失败为 stanza 错误条件 */
type LangTransResult = LangTransResultDetail | LangTransFailureResult;

interface LangTransResultDetail {
  /** 译文 */
  text: string;
  /** 实际使用的源语言（xs:language / BCP 47）；省略时用请求的 sourceLang */
  sourceLang?: string;
  /**
   * 实际使用的引擎：字符串 = 引擎名；"" = 机器翻译但名称不可用；
   * null = 人工翻译（不写 engine 属性）；省略 = 用 provider.engineName
   */
  engine?: string | null;
  /** 是否经人工复核，省略 false */
  reviewed?: boolean;
  /** 实际使用的词典；省略时回显请求的 dictionary */
  dictionary?: string;
  /** 译文使用的字符集；省略时回显请求的 charset */
  charset?: string;
}

/** 翻译失败：condition、type、text 分别对应 RFC 6120 `<error/>` 的子元素与属性 */
interface LangTransFailureResult {
  /** stanza 错误条件（RFC 6120 §8.3.3） */
  condition: ErrorConditions;
  /** `<error/>` 的 type（RFC 6120 §8.3.2）；§8.3.3 只给出推荐值，允许按情况选取 */
  type: ErrorTypes;
  /** 回给请求方的 `<text/>`；省略则不写，不要放内部细节 */
  text?: string;
}

/** 提供方配置的语言对：语言标签不能为空；jid 缺省填本端 bare JID，pivotable 缺省 false */
interface LangTransItemConfig {
  /** 源语言（xs:language / BCP 47），必填且不能为空 */
  sourceLang: string;
  /** 目标语言（xs:language / BCP 47）；省略时不写该属性，提供时不能为空 */
  destinationLang?: string;
  /** 提供该语言对的服务 JID；缺省填本端 bare JID */
  jid?: string;
  /** 服务显示名 */
  name?: string;
  /** 翻译引擎名 */
  engine?: string;
  /** 翻译引擎使用的词典名称 */
  dictionary?: string;
  /** 是否可作为 pivot，缺省 false */
  pivotable?: boolean;
}

/**
 * 翻译服务提供方（机器人）配置
 *
 * 插件不做身份校验：`translate` 与 `languages` 收到的是协议给出的 JID，需要授权时由回调自行判断。
 */
interface LangTransProvider {
  /** 翻译回调，按目标语言逐个并行调用；成功返回译文描述，失败返回错误条件；抛出的异常一律按 internal-server-error 处理 */
  translate: (task: LangTransTask) => LangTransResult | Promise<LangTransResult>;
  /** 回调未返回 engine 时的默认值：省略 = ""（机器翻译、名称不可用）；null = 人工翻译（不写 engine） */
  engineName?: string | null;
  /** 支持的语言对，用于应答 langtrans:items；数组或按请求方 JID 计算的同步函数；缺省应答空列表 */
  languages?:
    | LangTransItemConfig[]
    | ((from: string) => LangTransItemConfig[]);
  /** translate 回调超时（毫秒）；超时按 item-not-found 应答；0 或省略表示不限时 */
  timeoutMs?: number;
  /** 是否在 disco#info 宣告 urn:xmpp:langtrans 与 automation/translation；默认 true */
  advertise?: boolean;
}

/** registerPlugin("XEP0171", options) 的配置 */
interface XEP0171Options {
  /** 翻译服务提供方配置；缺省不提供翻译服务 */
  provider?: LangTransProvider;
}
```

### 配置

```typescript
client.registerPlugin("XEP0171", {
  provider: {
    translate: async ({ from, text, sourceLang, destinationLang, dictionary }) => {
      // 插件不校验来源：需要授权时在这里按 from 拒绝
      return await myTranslateApi(text, sourceLang, destinationLang, dictionary);
    },
    engineName: "MyMT 1.0",
    languages: [{ sourceLang: "en", destinationLang: "zh" }],
    timeoutMs: 10_000,
  },
});
```

### 行为

配置 `provider` 后，`init()` 监听 IQ `get`：

1. `<x xmlns='urn:xmpp:langtrans'>` 且含 `<source>`：
   - 按 `<translation>` **并行**调用 `translate`，入参带请求方 `from`（插件不做授权，需要时由回调自行校验）与请求声明的 `sourceLang`、`dictionary`、`charset`、`engine`。
   - 目标语言**不预先对照 `languages` 校验**，是否支持由回调决定（`languages` 可能只列部分能力或按词典细分）；不支持时返回 `item-not-found` 即可。
   - 任一目标失败时整单回一个错误 IQ，条件取自该目标：回调返回的 `{ condition, type }` 原样使用；`timeoutMs` 超时回 `<item-not-found/>`（`cancel`）；回调抛错或返回值形状非法回 `<internal-server-error/>`（`cancel`）。单个 IQ 不能同时带译文与错误，所以一个目标失败就丢弃其余目标的译文。
   - `<translation>` 带 `source_lang` 时按 §4.3.1 不构成请求，返回 `<error type='modify'><bad-request/></error>`。
   - 响应中的 `<translation>`：`destination_lang` 来自请求，`text` 来自返回值；`source_lang`、`engine`、`reviewed`、`dictionary`、`charset` 按返回值覆盖，缺省分别取请求的 `source_lang`、`provider.engineName`（再缺省 `""`）、`false`、请求的 `dictionary`、请求的 `charset`；`engine` 返回 `null` 时不写该属性（人工翻译）。
   - `timeoutMs` 超时按失败处理；省略或 `0` 表示不限时，回调不返回则该 IQ 不会得到应答。
2. `<query xmlns='urn:xmpp:langtrans:items'/>`：返回配置的语言对；每项的 `sourceLang` 必填且不能为空，`destinationLang` 提供时不能为空（空串不是自动识别的约定）；每项 `jid` 缺省填本端 bare JID；`languages` 为函数时用请求方 JID 计算；语言标签为空或非法时返回 `<error type='cancel'><internal-server-error/></error>`（规范未规定，此为插件约定）。
3. `<x>` 但缺 `<source>`：返回 `<error type='modify'><bad-request/></error>`（无法确定待翻译文本）。

`advertise` 为 `true` 时向 XEP-0030 添加：

- 特性 `urn:xmpp:langtrans`
- 身份 `category='automation' type='translation'`

### 编写 translate 回调

每个目标语言调用一次，多个目标并行；返回译文描述或错误条件，二选一。

**成功**：`text` 必填，其余字段决定响应 `<translation/>` 的属性：

```typescript
async function translate({ text, sourceLang, destinationLang }: LangTransTask) {
  const result = await myTranslationApi.translate(text, sourceLang, destinationLang);
  return {
    text: result.text,                                  // 必填
    sourceLang: result.detectedLang ?? undefined,       // 请求为 "und" 时上报识别结果
    engine: "MyMT 1.0",                                 // "" = 机器翻译但名称不可用；null = 人工翻译
    reviewed: result.reviewedByHuman,                   // 可选，缺省 false
  };
}
```

`engine` 省略时用 `provider.engineName`（再缺省 `""`）；`dictionary`、`charset` 省略时回显请求值。

**失败**：返回 `{ condition, type }`，直接写进响应的 `<error/>`：

```typescript
return { condition: "item-not-found", type: "cancel" };
```

常用取值（`type` 来自 RFC 6120 §8.3.3 的推荐值，按实际情况可调整）：

| condition | type | 适用场景 |
|-----------|------|----------|
| `item-not-found` | `cancel` | 不支持该语言对、无法翻译；XEP-0171 §4.3.1 对"无法完成翻译"的推荐条件 |
| `resource-constraint` | `wait` | 过载、超出并发或上游限流，请求方可稍后重试 |
| `forbidden` | `auth` | 按 `from` 拒绝授权（见下） |
| `not-acceptable` | `modify` | 源文本超长、请求参数无法处理，需修改请求才能成功 |
| `service-unavailable` | `cancel` | 暂时不提供翻译（如后端维护） |
| `internal-server-error` | `cancel` | 回调自身故障；抛出异常也会落到这里 |

表格只列常用场景，不是白名单：`condition` 可取 RFC 6120 §8.3.3 定义的全部条件（`ErrorConditions`），`type` 可取 `auth` / `cancel` / `continue` / `modify` / `wait`（`ErrorTypes`），插件原样写进 `<error/>`，不做过滤。

不要用抛异常表达业务失败：抛出和返回值形状非法一律按 `internal-server-error` 处理，请求方拿不到具体原因。

**来源校验**：插件不校验请求方，`task.from` 是协议给出的完整 JID，需要授权时在回调内自行判断：

```typescript
if (!allowlist.has(task.from)) {
  return { condition: "forbidden", type: "auth" };
}
```

**自动识别**：`sourceLang` 为 `"und"` 时应检测语种，成功返回值里用 `sourceLang` 上报检测结果；检测不了又无法翻译时返回 `item-not-found`。

**超时**：`provider.timeoutMs` 由插件计时，超时回 `item-not-found` 并丢弃回调结果；回调内部的超时控制可以并存，但时间应短于 `timeoutMs` 才有意义。

## 注意事项

- **消息投递**：`<x>` 只描述翻译关系，正文/主题的对应关系由同一条消息里多个带 `xml:lang` 的 `<body>`/`<subject>` 表达（XEP-0171 §6 要求客户端支持多语言 body）。
- **pivot**：`translations` 的顺序就是 pivot 顺序，例：`fr → en → ru` 对应两条 `translation`。
- **pivotable 语义未定义**：XEP-0171 只在 schema 中声明 `<item>` 的 `pivotable` 为 `xs:boolean`（缺省 false），正文没有说明它指“该语言对可作为 pivot 链的一环”还是“目标语言可作为 pivot”。解析时只保留布尔值，不要据此推导具体链路。
- **错误条件**：服务无法完成翻译时按 §4.3.1 返回 `item-not-found`（RFC 6120 §8.3.3.7 规定其 type 为 `cancel`）；隐私/安全原因不便暴露时用 `service-unavailable`（type `cancel`）。错误 IQ 按 RFC 6120 §8.3.1 回显请求载荷。
