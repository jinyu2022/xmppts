import { describe, expect, it, vi } from "vitest";
import XEP0171 from "../../../lib/plugins/xep0171";
import { LangTrans } from "../../../lib/plugins/xep0171/langtrans";
import type {
  LangTransProvider,
  LangTransTask,
  XEP0171Options,
} from "../../../lib/plugins/xep0171";
import type { Connection } from "../../../lib/connection";
import { Iq } from "../../../lib/stanza";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import { Status } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0171 插件入口单元测试：注册行为、请求方 API、提供方应答（翻译与 items 查询）。
 *
 * @see https://xmpp.org/extensions/xep-0171.html 1.1.1 §4.2.2（Example 7）、§4.2.3（Example 8/9）、
 *      §4.3.1（Example 10/11/16/17）、§4.3.2（Example 12/13）、§4.3.3（Example 14/15）
 */
describe("XEP0171 插件入口", () => {
  function setup(options?: XEP0171Options) {
    const connection = new FakeConnection();
    // 提供方应答前会检查会话状态：默认按已绑定处理
    connection.transport = { status: Status.BINDED };
    const plugin = new XEP0171(connection as unknown as Connection, options);
    plugin.init();
    return { connection, plugin };
  }

  /** 把 XML 转成 Iq 实例并派发到插件注册的 iq 监听器 */
  function emitIq(connection: FakeConnection, xml: string): Iq {
    const iq = new Iq(Parser.parse(xml), connection as unknown as Connection);
    connection.emit("iq", iq);
    return iq;
  }

  /** 取第一份应答 */
  function firstReply(connection: FakeConnection) {
    expect(connection.sent).toHaveLength(1);
    return connection.sent[0];
  }

  /** 断言应答是错误节，返回错误节中的条件元素名 */
  function errorCondition(reply: ReturnType<typeof firstReply>): string {
    expect(reply.getAttribute("type")).toBe("error");
    const error = reply.getElementsByTagName("error")[0];
    expect(error).toBeDefined();
    const condition = Array.from(error.children).find(
      (child) => child.namespaceURI === XMPPError.NS && child.localName !== "text",
    );
    return condition?.localName ?? "";
  }

  it("继承 LangTrans 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0171(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(LangTrans);
    expect(XEP0171.dependencies).toEqual(["XEP0030"]);
  });

  it("默认只有请求方角色：注册转换器但不宣告特性、不监听 iq", () => {
    const { connection } = setup();

    expect(connection.stanzaPlugins.get(XEP0171.NS.BASE)).toBe(
      XEP0171.parseLangTransEl,
    );
    expect(connection.features.size).toBe(0);
    expect(connection.XEP0030.identities).toHaveLength(0);
    expect(connection.listenerCount("iq")).toBe(0);
  });

  it("提供方模式宣告特性与 automation/translation 身份（Example 7）", () => {
    const { connection } = setup({ provider: { translate: () => ({ text: "" }) } });

    expect(connection.features.has(XEP0171.NS.BASE)).toBe(true);
    expect(connection.XEP0030.identities).toContainEqual({
      category: "automation",
      type: "translation",
      name: undefined,
      lang: undefined,
    });
    expect(connection.XEP0030.identities).toHaveLength(1);
  });

  it("重连重建插件与 XEP0030 后身份仍只有一条", () => {
    const provider = { translate: () => ({ text: "" }) };
    const { connection } = setup({ provider });
    // connect() 每次重建所有插件实例，XEP0030 的身份记录随新实例清空
    connection.XEP0030.identities = [];
    new XEP0171(connection as unknown as Connection, { provider }).init();
    expect(connection.XEP0030.identities).toHaveLength(1);
  });

  it("同一 XEP0030 实例上重复 init() 会与真实插件一样抛错", () => {
    const { plugin } = setup({ provider: { translate: () => ({ text: "" }) } });
    expect(() => plugin.init()).toThrow(/已经存在相同身份标识/);
  });

  it("advertise=false 时不宣告", () => {
    const { connection } = setup({
      provider: { translate: () => ({ text: "" }), advertise: false },
    });

    expect(connection.features.size).toBe(0);
    expect(connection.XEP0030.identities).toHaveLength(0);
  });

  it("提供方按目标语言翻译并回显原文（Example 10/11）", async () => {
    const provider: LangTransProvider = {
      engineName: "default",
      translate: ({ text, sourceLang, destinationLang }) => {
        // Example 10 的请求字段；Example 11 的译文
        expect(text).toBe("How are you?");
        expect(sourceLang).toBe("en");
        expect(destinationLang).toBe("fr");
        return { text: "comment allez-vous?" };
      },
    };
    const { connection } = setup({ provider });

    // Example 10
    emitIq(
      connection,
      `<iq from='bard@shakespeare.lt/globe' id='translationReq_2' to='translation.shakespeare.lit' type='get'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const reply = firstReply(connection);
    expect(reply.getAttribute("type")).toBe("result");
    expect(reply.getAttribute("id")).toBe("translationReq_2");
    expect(reply.getAttribute("to")).toBe("bard@shakespeare.lt/globe");

    const x = reply.getElementsByTagNameNS(XEP0171.NS.BASE, "x")[0];
    const source = x.getElementsByTagName("source")[0];
    // 响应回显请求的原文；Example 11 的 translation 属性是 destination_lang/source_lang/engine
    expect(source.getAttribute("xml:lang")).toBe("en");
    expect(source.textContent).toBe("How are you?");

    const translation = x.getElementsByTagName("translation")[0];
    expect(translation.getAttribute("destination_lang")).toBe("fr");
    expect(translation.getAttribute("source_lang")).toBe("en");
    expect(translation.getAttribute("engine")).toBe("default");
    // schema 缺省 reviewed=false，不写属性
    expect(translation.getAttribute("reviewed")).toBeNull();
    expect(translation.textContent).toBe("comment allez-vous?");
  });

  it("提供方按多个目标逐个调用，结果顺序与请求一致（Example 12/13）", async () => {
    const seen: string[] = [];
    const { connection } = setup({
      provider: {
        engineName: "default",
        translate: ({ destinationLang }) => {
          seen.push(destinationLang);
          return {
            text: destinationLang === "it" ? "Come siete?" : "Wie geht es Ihnen?",
          };
        },
      },
    });

    // Example 12
    emitIq(
      connection,
      `<iq from='bard@shakespeare.lt/globe' id='translationReq_4' to='translation.shakespeare.lit' type='get'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='it'/>
          <translation destination_lang='de'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(seen.sort()).toEqual(["de", "it"]);
    const translations = firstReply(connection).getElementsByTagName("translation");
    // Example 13
    expect(translations[0].getAttribute("destination_lang")).toBe("it");
    expect(translations[0].getAttribute("source_lang")).toBe("en");
    expect(translations[0].getAttribute("engine")).toBe("default");
    expect(translations[0].textContent).toBe("Come siete?");
    expect(translations[1].getAttribute("destination_lang")).toBe("de");
    expect(translations[1].getAttribute("source_lang")).toBe("en");
    expect(translations[1].getAttribute("engine")).toBe("default");
    expect(translations[1].textContent).toBe("Wie geht es Ihnen?");
  });

  it("按请求的 dictionary 调用并回显（Example 14/15）", async () => {
    let requested: LangTransTask | undefined;
    const { connection } = setup({
      provider: {
        engineName: "default",
        translate: (task) => {
          requested = task;
          return { text: "comment allez-vous?" };
        },
      },
    });

    // Example 14
    emitIq(
      connection,
      `<iq from='bard@shakespeare.lt/globe' id='translationReq_6' to='translation.shakespeare.lit' type='get'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr' dictionary='medical'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(requested?.dictionary).toBe("medical");
    const translation = firstReply(connection).getElementsByTagName("translation")[0];
    // Example 15
    expect(translation.getAttribute("destination_lang")).toBe("fr");
    expect(translation.getAttribute("dictionary")).toBe("medical");
    expect(translation.getAttribute("engine")).toBe("default");
    expect(translation.getAttribute("source_lang")).toBe("en");
    expect(translation.textContent).toBe("comment allez-vous?");
  });

  it("返回值可覆盖 source_lang/engine/reviewed/dictionary/charset", async () => {
    // 规范示例没有 reviewed 与人工翻译的组合，按 §4.1.1 的语义覆盖
    const { connection } = setup({
      provider: {
        engineName: "MyMT 1.0",
        translate: ({ destinationLang }) => {
          if (destinationLang === "fr") {
            // 人工翻译：engine 为 null，不写属性；其余字段覆盖请求值
            return {
              text: "Comment allez-vous ?",
              sourceLang: "zh",
              engine: null,
              reviewed: true,
              dictionary: "medical",
              charset: "utf-8",
            };
          }
          // 只返回译文，engine 取 provider.engineName
          return { text: "Wie geht es Ihnen?" };
        },
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_overrides' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr' dictionary='standard' charset='ascii'/>
          <translation destination_lang='de'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const translations = firstReply(connection).getElementsByTagName("translation");
    expect(translations[0].getAttribute("engine")).toBeNull();
    expect(translations[0].getAttribute("source_lang")).toBe("zh");
    expect(translations[0].getAttribute("reviewed")).toBe("true");
    expect(translations[0].getAttribute("dictionary")).toBe("medical");
    expect(translations[0].getAttribute("charset")).toBe("utf-8");

    expect(translations[1].getAttribute("engine")).toBe("MyMT 1.0");
    expect(translations[1].getAttribute("source_lang")).toBe("en");
    expect(translations[1].getAttribute("reviewed")).toBeNull();
    expect(translations[1].getAttribute("dictionary")).toBeNull();
  });

  it("provider.engineName 为 null 时按人工翻译不写 engine", async () => {
    const { connection } = setup({
      provider: { translate: () => ({ text: "Comment allez-vous ?" }), engineName: null },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_manual' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const translation = firstReply(connection).getElementsByTagName("translation")[0];
    // engineName=null 表示人工翻译，不能被 ?? "" 吞成空串
    expect(translation.getAttribute("engine")).toBeNull();
  });

  it("回调返回的语言标签非法时按内部错误处理", async () => {
    const { connection } = setup({
      provider: {
        translate: () => ({ text: "译文", sourceLang: "en_US" }),
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_bad-result' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("internal-server-error");
  });

  it("会话已结束时不再尝试应答", async () => {
    const { connection } = setup({
      provider: { translate: () => ({ text: "译文" }) },
    });
    // 模拟翻译回调期间断线
    connection.transport = { status: Status.DISCONNECTED };
    const send = vi.spyOn(connection, "send");

    emitIq(
      connection,
      `<iq type='get' id='translationReq_lost' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(send).not.toHaveBeenCalled();
    expect(connection.sent).toHaveLength(0);
  });

  it("translate 收到请求方完整 JID 与请求的扩展字段", async () => {
    let received: LangTransTask | undefined;
    const { connection } = setup({
      provider: {
        translate: (task) => {
          received = task;
          return { text: "Comment allez-vous ?" };
        },
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_task' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr' dictionary='medical' charset='utf-8' engine='SYSTRANS'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(received).toEqual({
      from: "bard@shakespeare.lt/globe",
      text: "How are you?",
      sourceLang: "en",
      destinationLang: "fr",
      dictionary: "medical",
      charset: "utf-8",
      engine: "SYSTRANS",
    });
  });

  it("回调抛错时返回 internal-server-error 并回显请求载荷", async () => {
    const { connection } = setup({
      provider: {
        translate: () => {
          throw new Error("引擎不可用");
        },
      },
    });

    const request = emitIq(
      connection,
      // Example 16 的请求载荷
      `<iq type='get' id='translationReq_7' from='bard@shakespeare.lt/globe' to='translation.shakespeare.lit'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='dy'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const reply = firstReply(connection);
    expect(errorCondition(reply)).toBe("internal-server-error");
    // RFC 6120 §8.3.1：错误节回显原请求载荷
    expect(reply.getElementsByTagNameNS(XEP0171.NS.BASE, "x")).toHaveLength(1);
    expect(reply.getElementsByTagNameNS(XEP0171.NS.BASE, "source")).toHaveLength(1);
    // 回显是复制：原请求节仍保留载荷，供同事件的其他监听器使用
    expect(request.xml.getElementsByTagNameNS(XEP0171.NS.BASE, "x")).toHaveLength(1);
  });

  it("回调返回失败字段时按该条件应答，type 由条件推导", async () => {
    const { connection } = setup({
      provider: {
        translate: () => ({
          condition: "resource-constraint",
          type: "wait",
          text: "配额已满",
        }),
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_quota' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const reply = firstReply(connection);
    expect(errorCondition(reply)).toBe("resource-constraint");
    const error = reply.getElementsByTagName("error")[0];
    // RFC 6120 §8.3.3：resource-constraint 的 type 为 wait
    expect(error.getAttribute("type")).toBe("wait");
    expect(
      error.getElementsByTagNameNS(XMPPError.NS, "text")[0].textContent,
    ).toBe("配额已满");
  });

  it("多目标时按请求顺序取第一个失败决定应答", async () => {
    const { connection } = setup({
      provider: {
        translate: ({ destinationLang }) =>
          destinationLang === "de"
            ? { text: "Wie geht es Ihnen?" }
            : { condition: "forbidden", type: "auth" },
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_multi' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='it'/>
          <translation destination_lang='de'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("forbidden");
  });

  it("回调超时按失败处理", async () => {
    const { connection } = setup({
      provider: {
        // 永不 settle，只有 timeoutMs 能让应答落地
        translate: () => new Promise<{ text: string }>(() => {}),
        timeoutMs: 5,
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_timeout' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("item-not-found");
  });

  it("多目标中任一失败时整单返回错误", async () => {
    const { connection } = setup({
      provider: {
        translate: ({ destinationLang }) =>
          destinationLang === "fr"
            ? { condition: "item-not-found", type: "cancel" }
            : { text: "How are you?" },
      },
    });

    emitIq(
      connection,
      `<iq type='get' id='translationReq_parallel' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
          <translation destination_lang='de'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("item-not-found");
  });

  it("带 source_lang 的 translation 不构成请求", async () => {
    const translate = vi.fn(() => ({ text: "x" }));
    const { connection } = setup({ provider: { translate } });

    emitIq(
      connection,
      `<iq type='get' id='not-a-request' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr' source_lang='en'/>
        </x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("bad-request");
    expect(translate).not.toHaveBeenCalled();
  });

  it("缺少 source 或没有目标时返回 bad-request", async () => {
    const { connection } = setup({ provider: { translate: () => ({ text: "x" }) } });

    emitIq(
      connection,
      `<iq type='get' id='no-source' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'><translation destination_lang='fr'/></x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(errorCondition(firstReply(connection))).toBe("bad-request");

    connection.sent.length = 0;
    emitIq(
      connection,
      `<iq type='get' id='no-target' from='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'><source xml:lang='en'>How are you?</source></x>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(errorCondition(firstReply(connection))).toBe("bad-request");
  });

  it("应答 langtrans:items 查询，jid 缺省为本端 bare JID（Example 9）", async () => {
    const { connection } = setup({
      provider: {
        translate: () => ({ text: "x" }),
        languages: [
          {
            sourceLang: "en",
            destinationLang: "fr",
            engine: "SYSTRANS 2005 Release 2",
            pivotable: true,
          },
          { sourceLang: "en", destinationLang: "de", name: "Tower of Babel" },
        ],
      },
    });

    // Example 8 的请求没有 id（RFC 6120 §8.2.3 要求 get 带 id），这里补一个以便关联应答
    emitIq(
      connection,
      `<iq type='get' id='disco-lang' to='translation.shakespeare.lit' from='bard@shakespeare.lit/globe'>
        <query xmlns='urn:xmpp:langtrans:items'/>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    const reply = firstReply(connection);
    expect(reply.getAttribute("type")).toBe("result");
    expect(reply.getAttribute("id")).toBe("disco-lang");
    expect(reply.getAttribute("to")).toBe("bard@shakespeare.lit/globe");
    const items = reply.getElementsByTagName("item");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("jid")).toBe("juliet@capulet.lit");
    expect(items[0].getAttribute("source_lang")).toBe("en");
    expect(items[0].getAttribute("destination_lang")).toBe("fr");
    expect(items[0].getAttribute("engine")).toBe("SYSTRANS 2005 Release 2");
    expect(items[0].getAttribute("pivotable")).toBe("true");
    // 缺省 pivotable=false 不写属性
    expect(items[1].getAttribute("pivotable")).toBeNull();
    expect(items[1].getAttribute("name")).toBe("Tower of Babel");
  });

  it("languages 为函数时按请求方完整 JID 计算", async () => {
    let received = "";
    const { connection } = setup({
      provider: {
        translate: () => ({ text: "x" }),
        languages: (from) => {
          received = from;
          return [];
        },
      },
    });

    emitIq(
      connection,
      `<iq type="get" id="disco4" from="bard@shakespeare.lit/globe">
        <query xmlns="urn:xmpp:langtrans:items"/>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(received).toBe("bard@shakespeare.lit/globe");
    // 空列表是合法应答，不是错误
    expect(firstReply(connection).getAttribute("type")).toBe("result");
    expect(firstReply(connection).getElementsByTagName("item")).toHaveLength(0);
  });

  it("未配置 languages 时应答空列表", async () => {
    const { connection } = setup({ provider: { translate: () => ({ text: "x" }) } });

    emitIq(
      connection,
      `<iq type="get" id="disco5" from="bard@shakespeare.lit/globe">
        <query xmlns="urn:xmpp:langtrans:items"/>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(firstReply(connection).getElementsByTagName("item")).toHaveLength(0);
  });

  it("计算语言对失败时返回 internal-server-error", async () => {
    const { connection } = setup({
      provider: {
        translate: () => ({ text: "x" }),
        languages: () => {
          throw new Error("后端不可用");
        },
      },
    });

    emitIq(
      connection,
      `<iq type="get" id="disco6" from="bard@shakespeare.lit/globe">
        <query xmlns="urn:xmpp:langtrans:items"/>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("internal-server-error");
  });

  it("配置的语言标签非法时返回 internal-server-error", async () => {
    const { connection } = setup({
      provider: {
        translate: () => ({ text: "x" }),
        languages: [{ sourceLang: "en_US" }],
      },
    });

    emitIq(
      connection,
      `<iq type="get" id="disco7" from="bard@shakespeare.lit/globe">
        <query xmlns="urn:xmpp:langtrans:items"/>
      </iq>`,
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

    expect(errorCondition(firstReply(connection))).toBe("internal-server-error");
  });

  it("服务端声明的语言对不能为空", async () => {
    // 空串不是合法的 xs:language，也不能约定为自动识别
    for (const item of [
      { sourceLang: "" },
      { sourceLang: "en", destinationLang: "" },
    ]) {
      const { connection } = setup({
        provider: { translate: () => ({ text: "x" }), languages: [item] },
      });

      emitIq(
        connection,
        `<iq type="get" id="disco-empty" from="bard@shakespeare.lit/globe">
          <query xmlns="urn:xmpp:langtrans:items"/>
        </iq>`,
      );
      await vi.waitFor(() => expect(connection.sent).toHaveLength(1));

      expect(errorCondition(firstReply(connection))).toBe("internal-server-error");
    }
  });

  it("requestTranslation 发送 IQ get 并解析响应（Example 11）", async () => {
    const { connection, plugin } = setup();
    // Example 11
    connection.sendAsyncResult = Parser.parse(
      `<iq type='result' id='translationReq_2' from='translation.shakespeare.lit' to='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>hello, how are you?</source>
          <translation destination_lang='fr' source_lang='en' engine='default'>comment allez-vous?</translation>
        </x>
      </iq>`,
    );

    const data = await plugin.requestTranslation("translation.shakespeare.lit", {
      text: "How are you?",
      sourceLang: "en",
      targets: [{ destinationLang: "fr" }],
    });

    const [request] = connection.sentAsync;
    expect(request.getAttribute("type")).toBe("get");
    expect(request.getAttribute("to")).toBe("translation.shakespeare.lit");
    // 与 Example 10 的 <x/> 一致
    expect(
      request.getElementsByTagNameNS(XEP0171.NS.BASE, "x")[0].toXMLString(),
    ).toBe(
      `<x xmlns="urn:xmpp:langtrans"><source xml:lang="en">How are you?</source><translation destination_lang="fr"/></x>`,
    );

    expect(data.source).toEqual({ lang: "en", text: "hello, how are you?" });
    expect(data.translations[0].text).toBe("comment allez-vous?");
    expect(data.translations[0].engine).toBe("default");
  });

  it("requestTranslation 在错误响应时抛 XMPPError（Example 16）", async () => {
    const { connection, plugin } = setup();
    // Example 16
    connection.sendAsyncResult = Parser.parse(
      `<iq type='error' id='translationReq_7' from='translation.shakespeare.lit' to='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='dy'/>
        </x>
        <error type='modify'>
          <bad-request xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
        </error>
      </iq>`,
    );

    const error = await plugin
      .requestTranslation("translation.shakespeare.lit", {
        text: "How are you?",
        sourceLang: "en",
        targets: [{ destinationLang: "dy" }],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(XMPPError);
    expect(error).toMatchObject({ type: "modify", condition: "bad-request" });
  });

  it("discoverLanguages 查询并解析语言对（Example 8/9）", async () => {
    const { connection, plugin } = setup();
    // Example 9（规范示例的 from 属性带前导空格，原样保留）
    connection.sendAsyncResult = Parser.parse(
      `<iq type='result' to='bard@shakespeare.lit/globe' from=' translation.shakespeare.lit'>
        <query xmlns='urn:xmpp:langtrans:items'>
          <item source_lang='en' jid='translation.shakespeare.lit' destination_lang='fr'
                engine='SYSTRANS 2005 Release 2' pivotable='true'/>
          <item source_lang='en' jid='translation.shakespeare.lit' destination_lang='ko'
                engine='SYSTRANS 2005 Release 2' pivotable='true'/>
          <item source_lang='en' jid='translation.shakespeare.lit' destination_lang='ru'
                engine='SYSTRANS 2005 Release 2' pivotable='true'/>
          <item source_lang='en' jid='translation.shakespeare.lit' destination_lang='ru'
                engine='SYSTRANS 2005 Release 2' pivotable='true' dictionary='medical'/>
          <item source_lang='fr' jid='translation.shakespeare.lit' destination_lang='en'
                engine='SYSTRANS 2005 Release 2' pivotable='true' dictionary='standard'/>
          <item source_lang='ru' jid='translation.shakespeare.lit' destination_lang='en'
                engine='SYSTRANS 2005 Release 2' pivotable='true' dictionary='Medical 1.0'/>
          <item source_lang='ko' jid='translation.shakespeare.lit' destination_lang='en'
                engine='SYSTRANS 2005 Release 2' pivotable='true'/>
        </query>
      </iq>`,
    );

    const items = await plugin.discoverLanguages("translation.shakespeare.lit");

    const [request] = connection.sentAsync;
    expect(request.getAttribute("type")).toBe("get");
    expect(request.getAttribute("to")).toBe("translation.shakespeare.lit");
    // 与 Example 8 的 <query/> 一致
    expect(
      request.getElementsByTagNameNS(XEP0171.NS.ITEMS, "query")[0].toXMLString(),
    ).toBe(`<query xmlns="urn:xmpp:langtrans:items"/>`);

    expect(items).toHaveLength(7);
    expect(items[0]).toEqual({
      sourceLang: "en",
      destinationLang: "fr",
      jid: "translation.shakespeare.lit",
      engine: "SYSTRANS 2005 Release 2",
      pivotable: true,
    });
    expect(items[3].dictionary).toBe("medical");
    expect(items[5].dictionary).toBe("Medical 1.0");
    expect(items[6]).toMatchObject({ sourceLang: "ko", destinationLang: "en" });
  });

  it("discoverLanguages 在错误响应时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    // 按 Example 17 的错误节；规范示例的 xmlns 少了 params，这里用正确的 stanzas 命名空间
    connection.sendAsyncResult = Parser.parse(
      `<iq type='error' id='translationReq_7' from='translation.shakespeare.lit' to='bard@shakespeare.lt/globe'>
        <error type='cancel'>
          <service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
        </error>
      </iq>`,
    );

    const error = await plugin
      .discoverLanguages("translation.shakespeare.lit")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(XMPPError);
    expect(error).toMatchObject({ type: "cancel", condition: "service-unavailable" });
  });
});
