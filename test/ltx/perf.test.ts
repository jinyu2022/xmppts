/**
 * lib/ltx 真实语料性能基准。
 *
 * 语料全部取自 RFC/XEP 示例（见各常量注释），不使用合成的畸形 XML：真实对端只会发规范
 * 文档，畸形输入的处理属于正确性问题（见 [lib/ltx/debug.md](../../lib/ltx/debug.md)）,
 * 不是性能场景。
 *
 * 运行：npx vitest run test/ltx/perf.test.ts --disable-console-intercept
 * 数据记录：lib/ltx/perf.md
 *
 * 口径：每项自适应定标迭代数后取 5 轮最小值，用于压制 JIT/GC 抖动。绝对值只反映量级；
 * 同一文件内前后对比可信，跨文件/跨版本不可直接比较。
 */
import { describe, it } from "vitest";
import os from "node:os";
import { LtxParser } from "@/ltx/LtxParser";
import { Parser } from "@/ltx/Parser";
import { XMPPElement } from "@/ltx/Element";
import { escapeXML, escapeXMLText, unescapeXML, unescapeXMLText } from "@/ltx/escape";

// ─────────────────────────── 计时 harness ───────────────────────────

/** 承接结果，阻止 V8 把纯计算整段消除 */
let sink: unknown;

const ROUNDS = 5;
const TARGET_MS = 8;

function timeOnce(fn: () => void, iters: number): number {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) {
    fn();
  }
  return performance.now() - t0;
}

/** 自适应定标：让单轮耗时落在 TARGET_MS 附近 */
function calibrate(fn: () => void): number {
  let iters = 1;
  for (let i = 0; i < 40; i++) {
    const ms = timeOnce(fn, iters);
    if (ms >= TARGET_MS * 0.6) {
      return iters;
    }
    iters = Math.min(
      2_000_000,
      Math.max(iters + 1, Math.ceil(iters * (TARGET_MS / Math.max(ms, 1e-3)))),
    );
  }
  return iters;
}

/** 测一项，输出 ns/op */
function scn(label: string, corpus: string, fn: () => void): void {
  const iters = calibrate(fn);
  timeOnce(fn, iters);
  let best = Infinity;
  for (let r = 0; r < ROUNDS; r++) {
    best = Math.min(best, timeOnce(fn, iters));
  }
  console.log(`[scn] ${label} :: ${corpus} :: ${((best / iters) * 1e6).toFixed(0)}ns/op`);
}

// ─────────────────────────── 语料 ───────────────────────────

/** RFC 6121 §5.2.2 聊天消息 + XEP-0203 §2 delay */
const CHAT_MSG =
  `<message xmlns="jabber:client" from="juliet@example.com/balcony" id="aab1a" to="romeo@example.net" type="chat" xml:lang="en">` +
  `<body>Wherefore art thou, Romeo? I have been waiting since the party ended, and the night is cold.</body>` +
  `<delay xmlns="urn:xmpp:delay" from="capulet.com" stamp="2002-09-10T23:08:25Z">Offline Storage</delay>` +
  `</message>`;

/** RFC 6121 §2.1.3 roster 结果（4 个 item） */
const ROSTER =
  `<iq xmlns="jabber:client" from="juliet@example.com/balcony" id="bv1bs71f" to="juliet@example.com" type="result">` +
  `<query xmlns="jabber:iq:roster" ver="ver7">` +
  `<item jid="benvolio@example.org" name="Benvolio" subscription="both"><group>Friends</group><group>Verona</group></item>` +
  `<item jid="mercutio@example.org" name="Mercutio" subscription="both"><group>Friends</group></item>` +
  `<item jid="nurse@example.com" name="Nurse" subscription="from"><group>Family</group></item>` +
  `<item jid="romeo@example.net" name="Romeo" subscription="to"><group>Friends</group></item>` +
  `</query></iq>`;

/** XEP-0045 §7.2.2 MUC 自身出席 */
const MUC_PRESENCE =
  `<presence xmlns="jabber:client" from="coven@chat.shakespeare.lit/firstwitch" id="n13mt3l" to="hag66@shakespeare.lit/pda">` +
  `<x xmlns="http://jabber.org/protocol/muc#user">` +
  `<item affiliation="owner" jid="hag66@shakespeare.lit/pda" role="moderator"/>` +
  `<status code="110"/>` +
  `</x></presence>`;

/** XEP-0030 disco#info 结果（2 个 identity + 8 个 feature） */
const DISCO_INFO =
  `<iq xmlns="jabber:client" from="shakespeare.lit" id="info1" to="romeo@montague.lit/orchard" type="result">` +
  `<query xmlns="http://jabber.org/protocol/disco#info">` +
  `<identity category="conference" name="Chat Rooms" type="text"/>` +
  `<identity category="server" name="Shakespeare IM" type="im"/>` +
  `<feature var="http://jabber.org/protocol/disco#info"/>` +
  `<feature var="http://jabber.org/protocol/disco#items"/>` +
  `<feature var="http://jabber.org/protocol/muc"/>` +
  `<feature var="http://jabber.org/protocol/pubsub"/>` +
  `<feature var="jabber:iq:register"/>` +
  `<feature var="jabber:iq:roster"/>` +
  `<feature var="urn:xmpp:carbons:2"/>` +
  `<feature var="urn:xmpp:ping"/>` +
  `</query></iq>`;

/** XEP-0004 §3.1 表单（title + instructions + 5 个 field） */
const FORM =
  `<x xmlns="jabber:x:data" type="form">` +
  `<title>Bot Configuration</title>` +
  `<instructions>Fill out this form to configure your new bot!</instructions>` +
  `<field type="hidden" var="FORM_TYPE"><value>jabber:bot</value></field>` +
  `<field type="fixed"><value>Section 1: Bot Info</value></field>` +
  `<field type="text-single" label="The name of your bot" var="botname"/>` +
  `<field type="text-multi" label="Helpful description of your bot" var="description"/>` +
  `<field type="boolean" label="Public?" var="public"><value>false</value></field>` +
  `</x>`;

/** 长正文 groupchat 消息（≈2 KB，活跃 MUC 房里的常见形态） */
const LONG_MSG =
  `<message xmlns="jabber:client" from="coven@chat.shakespeare.lit/firstwitch" to="hag66@shakespeare.lit/pda" type="groupchat">` +
  `<body>${"Double, double toil and trouble; fire burn, and cauldron bubble. ".repeat(35)}</body>` +
  `</message>`;

/** 会话流：流头 + 15 组混合 stanza + 流尾 */
const SESSION = [
  `<stream:stream xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams" from="example.com" id="c2s1" version="1.0">`,
  ...Array.from({ length: 15 }, () => CHAT_MSG + ROSTER + MUC_PRESENCE + DISCO_INFO),
  `</stream:stream>`,
].join("");

const XMPP_NS = "jabber:client";
const DISCO_NS = "http://jabber.org/protocol/disco#info";

/** 切块 write，模拟 socket 读块 */
function writeChunks(data: string, size: number, parser: { write(s: string): void }): void {
  for (let i = 0; i < data.length; i += size) {
    parser.write(data.slice(i, i + size));
  }
}

console.log(
  `[env] node ${process.version} / ${os.cpus()[0]?.model ?? "unknown"} / ${os.platform()}`,
);
for (const [name, xml] of [
  ["CHAT_MSG", CHAT_MSG],
  ["ROSTER", ROSTER],
  ["MUC_PRESENCE", MUC_PRESENCE],
  ["DISCO_INFO", DISCO_INFO],
  ["FORM", FORM],
  ["LONG_MSG", LONG_MSG],
  ["SESSION", SESSION],
] as const) {
  console.log(`[corpus] ${name}: ${Buffer.byteLength(xml, "utf8")}B`);
}

// ─────────────────────────── 解析 ───────────────────────────

describe("解析（真实语料）", () => {
  const cases = [
    ["CHAT_MSG", CHAT_MSG],
    ["ROSTER", ROSTER],
    ["MUC_PRESENCE", MUC_PRESENCE],
    ["DISCO_INFO", DISCO_INFO],
    ["FORM", FORM],
    ["LONG_MSG", LONG_MSG],
  ] as const;

  it("SAX 层单条", () => {
    for (const [name, xml] of cases) {
      scn("SAX", name, () => {
        new LtxParser().write(xml);
      });
    }
  }, 300_000);

  it("建树单条", () => {
    for (const [name, xml] of cases) {
      scn("Parser.parse", name, () => {
        sink = Parser.parse(xml);
      });
    }
  }, 300_000);

  it("会话流 SESSION：整块 vs 16KB 分块", () => {
    scn("SAX", "SESSION 整块", () => new LtxParser().write(SESSION));
    scn("SAX", "SESSION 16KB 分块", () => writeChunks(SESSION, 16 * 1024, new LtxParser()));
    scn("建树", "SESSION 整块", () => {
      const p = new Parser();
      p.on("tree", () => {});
      p.write(SESSION);
    });
    scn("建树", "SESSION 16KB 分块", () => {
      const p = new Parser();
      p.on("tree", () => {});
      writeChunks(SESSION, 16 * 1024, p);
    });
  }, 300_000);
});

// ─────────────────────────── 查询 ───────────────────────────

describe("查询（解析产物上，真实语料）", () => {
  const iq = Parser.parse(DISCO_INFO);
  const form = Parser.parse(FORM);
  const roster = Parser.parse(ROSTER);
  const msg = Parser.parse(CHAT_MSG);
  const presence = Parser.parse(MUC_PRESENCE);

  it("插件实际调用的形态", () => {
    scn('querySelector(":scope > body")', "CHAT_MSG", () => {
      sink = msg.querySelector(":scope > body");
    });
    scn('querySelector(":scope > field")', "FORM", () => {
      sink = form.querySelector(":scope > field");
    });
    scn('querySelector(":scope > x")', "MUC_PRESENCE", () => {
      sink = presence.querySelector(":scope > x");
    });
    scn('querySelector("query > identity")', "DISCO_INFO", () => {
      sink = iq.querySelector("query > identity");
    });
    scn('getElementsByTagName("feature")', "DISCO_INFO", () => {
      sink = iq.getElementsByTagName("feature");
    });
    scn('querySelectorAll("feature")', "DISCO_INFO", () => {
      sink = iq.querySelectorAll("feature");
    });
    scn('getElementsByTagName("item")', "ROSTER", () => {
      sink = roster.getElementsByTagName("item");
    });
    scn('getElementsByTagNameNS(disco, "feature")', "DISCO_INFO", () => {
      sink = iq.getElementsByTagNameNS(DISCO_NS, "feature");
    });
    scn('getElementsByTagNameNS(jabber:client, "item")', "ROSTER", () => {
      sink = roster.getElementsByTagNameNS(XMPP_NS, "item");
    });
    scn('querySelectorAll("field")', "FORM", () => {
      sink = form.querySelectorAll("field");
    });
    scn('querySelectorAll("item")', "ROSTER", () => {
      sink = roster.querySelectorAll("item");
    });
    scn('matches("[type=result]")', "DISCO_INFO", () => {
      sink = iq.matches('[type="result"]');
    });
  }, 300_000);
});

// ─────────────────────────── 序列化 ───────────────────────────

describe("序列化（真实语料）", () => {
  const iq = Parser.parse(DISCO_INFO);
  const roster = Parser.parse(ROSTER);
  const msg = Parser.parse(CHAT_MSG);
  const longMsg = Parser.parse(LONG_MSG);

  it("出站路径 toXMLString / write(writer)", () => {
    scn("toXMLString", "CHAT_MSG", () => {
      sink = msg.toXMLString();
    });
    scn("write(writer)", "CHAT_MSG", () => {
      let n = 0;
      msg.write((chunk) => {
        n += chunk.length;
      });
      sink = n;
    });
    scn("toXMLString", "ROSTER", () => {
      sink = roster.toXMLString();
    });
    scn("toXMLString", "DISCO_INFO", () => {
      sink = iq.toXMLString();
    });
    scn("toXMLString", "LONG_MSG", () => {
      sink = longMsg.toXMLString();
    });
    scn("toXMLString() 缩进 2", "CHAT_MSG", () => {
      sink = msg.toXMLString(2);
    });
  }, 300_000);

  it("入站路径 textContent / 整树遍历", () => {
    scn("textContent", "CHAT_MSG", () => {
      sink = msg.textContent;
    });
    scn("textContent", "LONG_MSG", () => {
      sink = longMsg.textContent;
    });
    scn("textContent", "DISCO_INFO（无文本）", () => {
      sink = iq.textContent;
    });
  }, 300_000);
});

// ─────────────────────────── 属性与树操作 ───────────────────────────

describe("属性与树操作（真实语料）", () => {
  const msg = Parser.parse(CHAT_MSG);
  const form = Parser.parse(FORM);

  it("读写与 COW", () => {
    scn("getAttribute 命中", "CHAT_MSG", () => {
      sink = msg.getAttribute("id");
    });
    scn("getAttribute 缺失", "CHAT_MSG", () => {
      sink = msg.getAttribute("nope");
    });
    scn("setAttribute 覆盖", "CHAT_MSG", () => {
      msg.setAttribute("id", "aab1a");
    });
    scn("removeAttribute", "CHAT_MSG", () => {
      msg.removeAttribute("id");
      msg.setAttribute("id", "aab1a");
    });
    scn("首次 setAttribute（EMPTY_ATTRS 建表）", "新建元素", () => {
      XMPPElement.createElement("message").setAttribute("k", "v");
    });
    scn("createElement 6 属性", "roster item 形态", () => {
      sink = XMPPElement.createElement("item", {
        jid: "benvolio@example.org",
        name: "Benvolio",
        subscription: "both",
        ask: "subscribe",
        approved: "true",
        ver: "ver7",
      });
    });
  }, 300_000);

  it("集合与子节点访问", () => {
    const items = Parser.parse(ROSTER).getElementsByTagNameNS(XMPP_NS, "item");
    scn("length", "ROSTER item ×4", () => {
      sink = items.length;
    });
    scn("下标 [0]", "ROSTER item ×4", () => {
      sink = items[0];
    });
    scn("迭代 for-of", "ROSTER item ×4", () => {
      let n = 0;
      for (const el of items) {
        n += el.tagName.length;
      }
      sink = n;
    });
    scn("children getter", "FORM", () => {
      sink = form.children.length;
    });
    scn("firstElementChild", "FORM", () => {
      sink = form.firstElementChild;
    });
    scn("previousElementSibling", "FORM", () => {
      sink = form.lastElementChild?.previousElementSibling;
    });
  }, 300_000);
});

// ─────────────────────────── escape / unescape ───────────────────────────

describe("escape / unescape（真实文本）", () => {
  const body = "Wherefore art thou, Romeo? I have been waiting since the party ended.";
  const quoted = `Tom & Jerry said "let's go" <fast> & farewell`;
  const entities = "a &amp; b &lt; c &gt; d &quot; e &apos;";
  const numeric = "x &#38; y &#60; z &#62; w";

  it("转义与实体反转义", () => {
    scn("escapeXMLText", "正文（无特殊字符）", () => {
      sink = escapeXMLText(body);
    });
    scn("escapeXMLText", "正文（含 &<>）", () => {
      sink = escapeXMLText(quoted);
    });
    scn("escapeXML", "属性值（含引号）", () => {
      sink = escapeXML(quoted);
    });
    scn("unescapeXML", "命名实体", () => {
      sink = unescapeXML(entities);
    });
    scn("unescapeXMLText", "数字实体", () => {
      sink = unescapeXMLText(numeric);
    });
    scn("unescapeXML", "无实体（短路）", () => {
      sink = unescapeXML(body);
    });
  }, 300_000);
});

// 各用例只把结果写进 sink 防 DCE，这里读一次以满足未使用变量检查
void sink;
