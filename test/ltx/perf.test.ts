/**
 * lib/ltx 性能基准。
 *
 * 对应 lib/ltx/perf.md 中的实测数据，条目编号一致（P1-P9）。
 * 运行：npx vitest run test/ltx/perf.test.ts --disable-console-intercept
 *
 * 输出为「多轮取最小值」，用于压制 JIT/GC 抖动，不代表精确值，只反映数量级与增长曲线。
 */
import { describe, it } from "vitest";
import { EventEmitter } from "node:events";
import os from "node:os";
import { LtxParser } from "@/ltx/LtxParser";
import { Parser } from "@/ltx/Parser";
import { XMPPElement } from "@/ltx/Element";
import { escapeXML, unescapeXML } from "@/ltx/escape";

/** 执行 fn 多轮，返回最小耗时（毫秒） */
function bench(fn: () => void, rounds = 5): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

console.log(
  `[env] node ${process.version} / ${os.cpus()[0]?.model ?? "unknown"} / ${os.platform()}`,
);

describe("P1 文本 fast-path 落空退化", () => {
  it("无 '<' 纯文本：单次 write 的规模增长", () => {
    for (const kb of [16, 32, 64, 128]) {
      const data = "x".repeat(kb * 1024);
      const ms = bench(() => {
        new LtxParser().write(data);
      }, 3);
      console.log(`[P1] plain ${kb}KB single-write: ${ms.toFixed(2)}ms`);
    }
  });

  it("对照：同数据切成 16KB 块", () => {
    for (const kb of [16, 32, 64, 128]) {
      const data = "x".repeat(kb * 1024);
      const ms = bench(() => {
        const p = new LtxParser();
        for (let i = 0; i < data.length; i += 16 * 1024) {
          p.write(data.slice(i, i + 16 * 1024));
        }
      }, 3);
      console.log(`[P1] plain ${kb}KB 16KB-chunks: ${ms.toFixed(2)}ms`);
    }
  });

  it("对照：每 512 字符夹一个 <a/>（fast-path 命中）", () => {
    for (const kb of [16, 32, 64, 128]) {
      const unit = "x".repeat(511) + "<a/>";
      const data = unit.repeat(Math.ceil((kb * 1024) / unit.length));
      const ms = bench(() => {
        new LtxParser().write(data);
      }, 3);
      console.log(`[P1] tagged ${kb}KB single-write: ${ms.toFixed(2)}ms`);
    }
  });
});

/**
 * P2：注释/处理指令跨 write 边界吞数据 + 结束标记后文本丢失（上游 xmppjs/ltx 同款）。
 *
 * 运行时刻状况（2026-10-06）
 * 环境：Windows / node v22.23.2 / Intel i5-11400H
 * 上游：ltx v3.1.2，默认解析器 src/parsers/ltx.js（SaxLtx）
 *
 * 上游最小复现（ltx 仓库根目录执行，无需构建）：
 *
 *   node --input-type=module -e "import P from './src/parsers/ltx.js'; const cs=[['<!-- c --','><m/>'],['<?pi ?','><m/>'],['<!--x-->hello','<b/>'],['<m><![CDATA[ab]',']]>c</m>']]; for(const [a,b] of cs){const p=new P();const L=[];p.on('startElement',n=>L.push('start:'+n));p.on('text',s=>L.push('text:'+JSON.stringify(s)));p.on('endElement',n=>L.push('end:'+n));p.write(a);if(b)p.write(b);const s=L.join(' + ');console.log(JSON.stringify([a,b]),'->',s===''?'(empty)':s)}"
 *
 * 上游实测输出：
 *   ["<!-- c --","><m/>"]                -> (empty)                        跨块注释：<m/> 整体丢失
 *   ["<?pi ?","><m/>"]                   -> (empty)                        跨块指令：<m/> 整体丢失
 *   ["<!--x-->hello","<b/>"]             -> start:b + end:b                同块注释可关闭，但 "hello" 丢失
 *   ["<m><![CDATA[ab]", "]]>c</m>"]      -> start:m + text:"ab]" + end:m    正常跨块 CDATA 可识别，但 "c" 丢失
 *
 * 本仓库 LtxParser 同条件对照（已补注释/指令退出的 recordStart，其余相同）：
 *   (empty) / (empty) / text:"hello" + start:b + end:b / start:m + text:"ab]" + end:m
 *
 * 成因
 *   1. 跨块吞数据：进入注释/指令即清空 recordStart（上游 #L156、#L160），关闭检测只回看所在块的
 *      前两个字符（上游 #L170-L184 的 charCodeAt(pos - 1/-2)，跨块时为 NaN），又无 remainder 可
 *      恢复（CDATA 有 parseRemainder 所以能正常跨块）→ 忽略态一直持续，后续数据被吞。
 *   2. 关不掉的文本丢失：关闭后不重设 recordStart（上游 #L176、#L184；本仓库在注释/指令处补了
 *      recordStart = pos + 1，CDATA 退出处 [#L189](lib/ltx/LtxParser.ts#L189) 未补）→ 结束标记
 *      后的文本在下一次 '<' 处因 recordStart 为空而丢弃。
 *
 * 期望：跨块时正确识别 '-->' / '?>' / ']]>'，且结束标记后的文本按普通文本上报。
 *
 * 修复方向：进入忽略态时记录 recordStart 或把尾部留作 remainder 供下次 write 重扫；关闭后
 * 一律 recordStart = pos + 1。上游同文件的 fast-path 落空退化（#L73 等，本仓库 P1）可另开 issue。
 */
describe("P2 注释/指令跨块与退出后文本", () => {
  it("注释 / 指令跨块吞数据；结束标记后的文本保留情况（正确性，与上游 ltx 同款）", () => {
    const cases: Array<[string, string, string]> = [
      ["comment split", "<!-- c --", "><m/>"],
      ["pi split", "<?pi ?", "><m/>"],
      ["comment then text (same chunk)", "<!--x-->hello", "<b/>"],
      ["cdata split + trailing text", "<m><![CDATA[ab]", "]]>c</m>"],
    ];
    for (const [label, first, second] of cases) {
      const p = new LtxParser();
      const events: string[] = [];
      p.on("startElement", (n) => events.push("start:" + n));
      p.on("text", (s) => events.push("text:" + JSON.stringify(s)));
      p.on("endElement", (n) => events.push("end:" + n));
      p.write(first);
      p.write(second);
      console.log(
        `[P2] ${label} -> ${events.length ? events.join(" + ") : "(empty)"}`,
      );
    }
  });

  it("注释未闭合时（块内无 '-->'）的单块耗时", () => {
    for (const kb of [16, 32, 64, 128]) {
      const data = "<!-- " + "x".repeat(kb * 1024);
      const ms = bench(() => {
        new LtxParser().write(data);
      }, 3);
      console.log(`[P2] open-comment ${kb}KB single-write: ${ms.toFixed(2)}ms`);
    }
  });
});

/**
 * P9：ATTR_VALUE / COMMENT / CDATA 分支 fast-path 落空后的平方级退化（2026-10-12 修复）。
 *
 * 修复后单块耗时与块长脱钩；分块路径残留的是 remainder 每次重拼的成本（P12）。
 * 各状态的修复前数据见 lib/ltx/perf.md 的 P9。
 */
describe("P9 fast-path 落空（三态）", () => {
  const states: Array<[string, (kb: number) => string]> = [
    ["text", (kb) => "x".repeat(kb * 1024)],
    ["attr-value", (kb) => '<m a="' + "x".repeat(kb * 1024)],
    ["cdata", (kb) => "<m><![CDATA[" + "x".repeat(kb * 1024)],
    ["cdata-tail ]", (kb) => "<m><![CDATA[" + "x".repeat(kb * 1024 - 1) + "]"],
  ];

  it("单块 write：16KB~128KB", () => {
    for (const [name, make] of states) {
      const parts: string[] = [];
      for (const kb of [16, 32, 64, 128]) {
        const data = make(kb);
        parts.push(`${kb}KB=${bench(() => new LtxParser().write(data)).toFixed(2)}ms`);
      }
      console.log(`[P9] ${name} single-write: ${parts.join(" ")}`);
    }
  });

  it("对照：128KB 分 16KB 块（remainder 重拼，见 P12）", () => {
    for (const [name, make] of states) {
      const data = make(128);
      const ms = bench(() => {
        const p = new LtxParser();
        for (let i = 0; i < data.length; i += 16 * 1024) {
          p.write(data.slice(i, i + 16 * 1024));
        }
      });
      console.log(`[P9] ${name} 128KB 16KB-chunks: ${ms.toFixed(2)}ms`);
    }
  });

  it("跨块 ']]>'：块尾为 ']' / ']]' 时仍可识别", () => {
    const splits: Array<[string, string]> = [
      ["ab]", "]>c</m>"],
      ["ab]]", ">c</m>"],
    ];
    for (const [head, tail] of splits) {
      const p = new LtxParser();
      const events: string[] = [];
      p.on("startElement", (n) => events.push("start:" + n));
      p.on("text", (s) => events.push("text:" + JSON.stringify(s)));
      p.on("endElement", (n) => events.push("end:" + n));
      p.write("<m><![CDATA[" + head);
      p.write(tail);
      console.log(`[P9] cdata split ${JSON.stringify(head)} -> ${events.join(" + ")}`);
    }
  });
});

describe("P3 接收路径的无条件序列化", () => {
  it("toXMLString 单件成本（debug 关闭时仍会跑）", () => {
    const small = Parser.parse(
      "<message to='a@b/c' id='1' type='chat'><body>hello world</body></message>",
    );
    const big = Parser.parse(
      "<message to='a@b/c' id='2' type='chat'>" +
        "<item a='1'><x>hello</x></item>".repeat(50) +
        "</message>",
    );
    const nSmall = 20000;
    const nBig = 5000;
    const smallMs = bench(() => {
      for (let i = 0; i < nSmall; i++) small.toXMLString();
    }, 3);
    const bigMs = bench(() => {
      for (let i = 0; i < nBig; i++) big.toXMLString();
    }, 3);
    const smallUs = (smallMs / nSmall) * 1000;
    const bigUs = (bigMs / nBig) * 1000;
    console.log(`[P3] small stanza: ${smallUs.toFixed(2)}us/次 (${smallMs.toFixed(1)}ms/${nSmall})`);
    console.log(`[P3] big stanza(50子元素): ${bigUs.toFixed(1)}us/次 (${bigMs.toFixed(1)}ms/${nBig})`);
    console.log(`[P3] 换算白烧: 100 stanza/s -> small ${((smallUs * 100) / 1000).toFixed(2)}ms/s, big ${((bigUs * 100) / 1000).toFixed(1)}ms/s`);
  });
});

describe("P4 元素解析的固定分配", () => {
  const n = 200000;

  it("createElement：零属性 vs 4 属性", () => {
    const pool: XMPPElement[] = new Array(n);
    const emptyMs = bench(() => {
      for (let i = 0; i < n; i++) pool[i] = XMPPElement.createElement("x");
    }, 3);
    const attrsMs = bench(() => {
      for (let i = 0; i < n; i++)
        pool[i] = XMPPElement.createElement("x", {
          id: "1",
          to: "a@b",
          type: "chat",
          from: "c@d",
        });
    }, 3);
    console.log(`[P4] createElement x${n}: 空 ${emptyMs.toFixed(1)}ms (${((emptyMs / n) * 1e6).toFixed(0)}ns/个)`);
    console.log(`[P4] createElement x${n}: 4属性 ${attrsMs.toFixed(1)}ms (${((attrsMs / n) * 1e6).toFixed(0)}ns/个)`);
  });

  it("Object.create(null) vs {} 分配成本", () => {
    const pool: object[] = new Array(1000000);
    const nullProtoMs = bench(() => {
      for (let i = 0; i < pool.length; i++) pool[i] = Object.create(null);
    }, 3);
    const plainProtoMs = bench(() => {
      for (let i = 0; i < pool.length; i++) pool[i] = {};
    }, 3);
    console.log(`[P4] 100 万次分配: Object.create(null) ${nullProtoMs.toFixed(1)}ms, {} ${plainProtoMs.toFixed(1)}ms`);
  });

  it("EventEmitter.emit vs 直接函数调用", () => {
    const emitter = new EventEmitter();
    let acc = 0;
    const direct = (v: number): void => {
      acc += v;
    };
    emitter.on("e", direct);
    const m = 1000000;
    const emitMs = bench(() => {
      for (let i = 0; i < m; i++) emitter.emit("e", i);
    }, 3);
    const directMs = bench(() => {
      for (let i = 0; i < m; i++) direct(i);
    }, 3);
    console.log(`[P4] 100 万次: emit ${emitMs.toFixed(1)}ms (${((emitMs / m) * 1e6).toFixed(0)}ns/次), 直接调用 ${directMs.toFixed(1)}ms`);
    void acc;
  });
});

describe("P5 namespaceURI 无缓存", () => {
  it("重复访问与全树 NS 查询", () => {
    const root = XMPPElement.createElement("root");
    root.setAttribute("xmlns", "urn:test");
    const all: XMPPElement[] = [];
    for (let i = 0; i < 50; i++) {
      const msg = XMPPElement.createElement("message");
      root.appendChild(msg);
      for (let j = 0; j < 20; j++) {
        const c = XMPPElement.createElement("child");
        msg.appendChild(c);
        all.push(c);
      }
    }
    const n = 100000;
    const nsMs = bench(() => {
      let len = 0;
      for (let i = 0; i < n; i++) len += all[i % all.length].namespaceURI!.length;
    }, 3);
    const tagMs = bench(() => {
      let len = 0;
      for (let i = 0; i < n; i++) len += all[i % all.length].tagName.length;
    }, 3);
    const walkMs = bench(() => {
      root.getElementsByTagNameNS("urn:test", "child");
    }, 3);
    console.log(`[P5] namespaceURI x${n}: ${nsMs.toFixed(1)}ms (${((nsMs / n) * 1e6).toFixed(0)}ns/次)；tagName 对照 ${tagMs.toFixed(1)}ms`);
    console.log(`[P5] getElementsByTagNameNS 全树(1000 元素): ${walkMs.toFixed(3)}ms/次`);
  });
});

describe("P6 querySelector 匹配阶段分配", () => {
  it(".class 分支（split+Set）与纯标签分支对比", () => {
    const root = XMPPElement.createElement("root");
    for (let i = 0; i < 1000; i++) {
      root.appendChild(XMPPElement.createElement("item").setAttribute("class", "item"));
    }
    const r = 50;
    const clsMs = bench(() => {
      for (let i = 0; i < r; i++) root.querySelectorAll(".item");
    });
    const tagMs = bench(() => {
      for (let i = 0; i < r; i++) root.querySelectorAll("item");
    });
    console.log(`[P6] querySelectorAll 1000 元素 x${r}: ".item" ${clsMs.toFixed(1)}ms vs "item" ${tagMs.toFixed(1)}ms`);
    console.log(`[P6] 单次: ${(clsMs / r).toFixed(3)}ms vs ${(tagMs / r).toFixed(3)}ms`);
  });
});

describe("P7 分块文本节点不合并", () => {
  it("1000 个相邻文本节点 vs 单节点的后续成本", () => {
    const joined = XMPPElement.createElement("body");
    joined.append("0123456789".repeat(1000));
    const split = XMPPElement.createElement("body");
    for (let i = 0; i < 1000; i++) split.append("0123456789");

    const r = 200;
    const joinedTextMs = bench(() => {
      for (let i = 0; i < r; i++) joined.textContent;
    });
    const splitTextMs = bench(() => {
      for (let i = 0; i < r; i++) split.textContent;
    });
    const joinedXmlMs = bench(() => {
      for (let i = 0; i < r; i++) joined.toXMLString();
    });
    const splitXmlMs = bench(() => {
      for (let i = 0; i < r; i++) split.toXMLString();
    });
    console.log(`[P7] textContent x${r} (10KB): 单节点 ${joinedTextMs.toFixed(2)}ms vs 1000 节点 ${splitTextMs.toFixed(2)}ms`);
    console.log(`[P7] toXMLString x${r}: 单节点 ${joinedXmlMs.toFixed(2)}ms vs 1000 节点 ${splitXmlMs.toFixed(2)}ms`);
  });
});

describe("P8 escape/unescape 吞吐", () => {
  it("1MB 数据的转义与反转义", () => {
    const oneMB = 1024 * 1024;
    const plain = "a".repeat(oneMB);
    const special = "a&<b>\"'c".repeat(oneMB / 7 + 1).slice(0, oneMB);
    const entities = "a&amp;b&lt;".repeat(oneMB / 10 + 1).slice(0, oneMB);

    for (const [label, s] of [
      ["plain", plain],
      ["special", special],
    ] as const) {
      const ms = bench(() => {
        escapeXML(s);
      });
      console.log(`[P8] escapeXML ${label} 1MB: ${ms.toFixed(2)}ms (${(1024 / ms).toFixed(0)} MB/s)`);
    }
    for (const [label, s] of [
      ["plain(shortcut)", plain],
      ["entities", entities],
    ] as const) {
      const ms = bench(() => {
        unescapeXML(s);
      });
      console.log(`[P8] unescapeXML ${label} 1MB: ${ms.toFixed(2)}ms (${(1024 / ms).toFixed(0)} MB/s)`);
    }
  });
});
