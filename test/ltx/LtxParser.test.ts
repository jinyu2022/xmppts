import { describe, expect, it, vi } from "vitest";
import { LtxParser } from "../../lib/ltx/LtxParser";

/**
 * LtxParser 单元测试：SAX 风格流式解析。
 * 覆盖标签/属性/文本事件、实体反转义、CDATA、注释与处理指令忽略、
 * 跨 chunk 分片解析与 end() 收尾。
 */

interface Event {
  type: "start" | "end" | "text";
  tag?: string;
  attrs?: Record<string, string>;
  selfClosing?: boolean;
  text?: string;
}

/** 解析 xml（可按 chunk 分片写入），收集全部事件 */
function collect(xml: string, chunkSize?: number): Event[] {
  const parser = new LtxParser();
  const events: Event[] = [];
  parser.on("startElement", (tag, attrs) => events.push({ type: "start", tag, attrs }));
  parser.on("endElement", (tag, selfClosing) =>
    events.push({ type: "end", tag, selfClosing }),
  );
  parser.on("text", (text) => events.push({ type: "text", text }));

  if (chunkSize) {
    for (let i = 0; i < xml.length; i += chunkSize) {
      parser.write(xml.slice(i, i + chunkSize));
    }
  } else {
    parser.write(xml);
  }
  parser.end();
  return events;
}

describe("LtxParser", () => {
  it("按文档顺序解析开始/结束标签与文本", () => {
    expect(collect(`<root a="1"><child>text</child></root>`)).toEqual([
      { type: "start", tag: "root", attrs: { a: "1" } },
      { type: "start", tag: "child", attrs: {} },
      { type: "text", text: "text" },
      { type: "end", tag: "child", selfClosing: false },
      { type: "end", tag: "root", selfClosing: false },
    ]);
  });

  it("自闭合标签触发 start 与 selfClosing=true 的 end", () => {
    expect(collect(`<a/><b x='y'/>`)).toEqual([
      { type: "start", tag: "a", attrs: {} },
      { type: "end", tag: "a", selfClosing: true },
      { type: "start", tag: "b", attrs: { x: "y" } },
      { type: "end", tag: "b", selfClosing: true },
    ]);
  });

  it("文本与属性值反转义 XML 实体", () => {
    expect(collect(`<a x="&lt;&amp;&quot;">1 &lt; 2 &amp; 3</a>`)).toEqual([
      { type: "start", tag: "a", attrs: { x: `<&"` } },
      { type: "text", text: "1 < 2 & 3" },
      { type: "end", tag: "a", selfClosing: false },
    ]);
  });

  it.each([undefined, 1, 3])("特殊属性名在分片大小 %s 下完整保留且各元素独立", (chunkSize) => {
    const xml = `<root __proto__="root&amp;value" constructor="ctor" toString="text" hasOwnProperty="own"><child __proto__="child"/><empty/></root>`;
    const starts = collect(xml, chunkSize).filter((event) => event.type === "start");

    expect(starts).toHaveLength(3);
    expect(starts[0].attrs).toEqual({
      ["__proto__"]: "root&value",
      constructor: "ctor",
      toString: "text",
      hasOwnProperty: "own",
    });
    expect(starts[1].attrs).toEqual({ ["__proto__"]: "child" });
    expect(starts[2].attrs).toEqual({});
    for (const { attrs } of starts) {
      expect(Object.getPrototypeOf(attrs)).toBeNull();
    }
    expect(starts[0].attrs).not.toBe(starts[1].attrs);
  });

  it.each([undefined, 1, 3])("数字字符引用在分片大小 %s 下正确还原", (chunkSize) => {
    expect(collect(`<a x="&#x3C;&#00065;">&#65;&#x1D11E;</a>`, chunkSize)).toEqual([
      { type: "start", tag: "a", attrs: { x: "<A" } },
      { type: "text", text: "A\u{1D11E}" },
      { type: "end", tag: "a", selfClosing: false },
    ]);
  });

  it.each([undefined, 1, 3])("分片大小 %s 下拒绝文本和属性中的残缺数字引用", (chunkSize) => {
    expect(() => collect(`<a>&#65junk;</a>`, chunkSize)).toThrow("Illegal XML entity");
    expect(() => collect(`<a x="&#x41junk;"/>`, chunkSize)).toThrow("Illegal XML entity");
  });

  it("分片写入时跨 chunk 的标签/属性/文本拼接正确", () => {
    const xml = `<root attr="value"><child>hello world</child></root>`;
    expect(collect(xml, 1)).toEqual(collect(xml));
    expect(collect(xml, 3)).toEqual(collect(xml));
  });

  it("CDATA 内容原样输出，且跨 chunk 的 ]]> 分片可识别", () => {
    const expected = [
      { type: "start", tag: "a", attrs: {} },
      { type: "text", text: "x < y & z" },
      { type: "end", tag: "a", selfClosing: false },
    ];
    expect(collect(`<a><![CDATA[x < y & z]]></a>`)).toEqual(expected);
    // 在 "]]" 与 ">" 之间分片，迫使解析器保存 remainder
    const xml = `<a><![CDATA[x < y & z]]></a>`;
    const cut = xml.indexOf("]]>") + 2;
    const parser = new LtxParser();
    const events: Event[] = [];
    parser.on("startElement", (tag, attrs) => events.push({ type: "start", tag, attrs }));
    parser.on("endElement", (tag, selfClosing) =>
      events.push({ type: "end", tag, selfClosing }),
    );
    parser.on("text", (text) => events.push({ type: "text", text }));
    parser.write(xml.slice(0, cut));
    parser.write(xml.slice(cut));
    parser.end();
    expect(events).toEqual(expected);
  });

  it("忽略注释与处理指令", () => {
    expect(collect(`<a><!-- comment --><?pi data?><b/></a>`)).toEqual([
      { type: "start", tag: "a", attrs: {} },
      { type: "start", tag: "b", attrs: {} },
      { type: "end", tag: "b", selfClosing: true },
      { type: "end", tag: "a", selfClosing: false },
    ]);
  });

  it("空文本不触发 text 事件", () => {
    const onText = vi.fn();
    const parser = new LtxParser();
    parser.on("text", onText);
    parser.write(`<a></a>`);
    parser.end();
    expect(onText).not.toHaveBeenCalled();
  });

  it("end() 时把未闭合的尾部文本作为最后一个 text 事件发出", () => {
    expect(collect(`<a>tail`)).toEqual([
      { type: "start", tag: "a", attrs: {} },
      { type: "text", text: "tail" },
    ]);
  });

  it("end() 之后 write 不再产生事件", () => {
    const parser = new LtxParser();
    const onStart = vi.fn();
    parser.on("startElement", onStart);
    parser.write(`<a/>`);
    parser.end();
    expect(onStart).toHaveBeenCalledTimes(1);

    parser.write(`<b/>`);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("end(data) 先写入剩余数据再收尾", () => {
    const parser = new LtxParser();
    const events: Event[] = [];
    parser.on("startElement", (tag, attrs) => events.push({ type: "start", tag, attrs }));
    parser.on("endElement", (tag, selfClosing) =>
      events.push({ type: "end", tag, selfClosing }),
    );
    parser.end(`<late/>`);
    expect(events).toEqual([
      { type: "start", tag: "late", attrs: {} },
      { type: "end", tag: "late", selfClosing: true },
    ]);
  });
});
