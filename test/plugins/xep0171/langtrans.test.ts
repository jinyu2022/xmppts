import { describe, expect, it } from "vitest";
import { LangTrans } from "../../../lib/plugins/xep0171/langtrans";
import { Parser } from "../../../lib/ltx/Parser";

/**
 * XEP-0171 工具类单元测试：`<x/>` 与 items 报文的解析/构造、语言标签词法校验。
 *
 * @see https://xmpp.org/extensions/xep-0171.html 1.1.1 §4.1.1（Example 1）、§4.1.3（Example 3）、
 *      §4.2.3（Example 8/9）、§4.3.1（Example 10/11）、§10 XML Schema、附录 G 注 3
 */
describe("XEP0171 LangTrans 工具类", () => {
  it("解析直接翻译的消息描述（Example 1）", () => {
    const message = Parser.parse(
      `<message xml:lang='en' from='bard@shakespeare.lit/globe' to='playwright@marlowe.lit/theatre'>
        <subject xml:lang='en'>Hello</subject>
        <subject xml:lang='fr'>Bonjour</subject>
        <body xml:lang='en'>How are you?</body>
        <body xml:lang='fr'>comment allez-vous?</body>
        <x xmlns='urn:xmpp:langtrans'>
          <translation destination_lang='fr' source_lang='en'/>
        </x>
      </message>`,
    );
    const x = message.getElementsByTagNameNS(LangTrans.NS.BASE, "x")[0];

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.translations).toEqual([
      { destinationLang: "fr", sourceLang: "en", reviewed: false },
    ]);
  });
  it("解析消息投递中的翻译描述（Example 3，含 pivot 与 engine）", () => {
    // Example 3：法语经英语中转成俄语，两条 translation 的顺序即 pivot 顺序
    const x = Parser.parse(
      `<x xmlns="urn:xmpp:langtrans">
        <translation destination_lang="en" engine="SYSTRANS" source_lang="fr"/>
        <translation destination_lang="ru" engine="SYSTRANS" source_lang="en"/>
      </x>`,
    );

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.source).toBeUndefined();
    expect(langTrans.translations).toHaveLength(2);
    expect(langTrans.translations[0]).toMatchObject({
      destinationLang: "en",
      sourceLang: "fr",
      engine: "SYSTRANS",
      reviewed: false,
    });
    expect(langTrans.translations[1]).toMatchObject({
      destinationLang: "ru",
      sourceLang: "en",
    });
    // 消息投递中的 translation 为空元素，没有译文
    expect(langTrans.translations[0].text).toBeUndefined();
  });

  it("解析请求时保留缺少 source_lang 的语义（Example 10）", () => {
    const iq = Parser.parse(
      `<iq from='bard@shakespeare.lt/globe' id='translationReq_2' to='translation.shakespeare.lit' type='get'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>How are you?</source>
          <translation destination_lang='fr'/>
        </x>
      </iq>`,
    );
    const x = iq.getElementsByTagNameNS(LangTrans.NS.BASE, "x")[0];

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.source).toEqual({ lang: "en", text: "How are you?" });
    expect(langTrans.translations).toHaveLength(1);
    expect(langTrans.translations[0].destinationLang).toBe("fr");
    // 属性缺失即“这是请求”
    expect(langTrans.translations[0].sourceLang).toBeUndefined();
    expect(langTrans.translations[0].engine).toBeUndefined();
  });

  it("解析响应中的译文与 reviewed（Example 11）", () => {
    const iq = Parser.parse(
      `<iq type='result' id='translationReq_2' from='translation.shakespeare.lit' to='bard@shakespeare.lt/globe'>
        <x xmlns='urn:xmpp:langtrans'>
          <source xml:lang='en'>hello, how are you?</source>
          <translation destination_lang='fr' source_lang='en' engine='default'>comment allez-vous?</translation>
        </x>
      </iq>`,
    );
    const x = iq.getElementsByTagNameNS(LangTrans.NS.BASE, "x")[0];

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.source?.text).toBe("hello, how are you?");
    expect(langTrans.translations[0].text).toBe("comment allez-vous?");
    expect(langTrans.translations[0].engine).toBe("default");
  });

  it("reviewed 接受 true/1 与 false/0（附录 G 注 3）", () => {
    const x = Parser.parse(
      `<x xmlns="urn:xmpp:langtrans">
        <translation destination_lang="fr" reviewed="true"/>
        <translation destination_lang="de" reviewed="1"/>
        <translation destination_lang="it" reviewed="false"/>
        <translation destination_lang="ru" reviewed="0"/>
      </x>`,
    );

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.translations.map((t) => t.reviewed)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("空 engine 表示机器翻译但引擎名不可用，不会被吞掉", () => {
    const x = Parser.parse(
      `<x xmlns="urn:xmpp:langtrans">
        <translation destination_lang="fr" source_lang="en" engine=""/>
        <translation destination_lang="de" source_lang="en"/>
      </x>`,
    );

    const { langTrans } = LangTrans.parseLangTransEl(x);
    expect(langTrans.translations[0].engine).toBe("");
    // 属性缺失 = 人工翻译
    expect(langTrans.translations[1].engine).toBeUndefined();
  });

  it("非 langtrans 命名空间的元素抛错", () => {
    const other = Parser.parse(`<x xmlns="urn:example:other"/>`);
    expect(() => LangTrans.parseLangTransEl(other)).toThrow("不是一个 langtrans 元素");
  });

  it("构造翻译请求 IQ（Example 10）", () => {
    const iq = LangTrans.createTranslationRequestIq("translation.shakespeare.lit", {
      text: "How are you?",
      sourceLang: "en",
      targets: [{ destinationLang: "fr" }],
    });

    expect(iq.tagName).toBe("iq");
    expect(iq.getAttribute("type")).toBe("get");
    expect(iq.getAttribute("to")).toBe("translation.shakespeare.lit");
    const x = iq.getElementsByTagNameNS(LangTrans.NS.BASE, "x")[0];
    const source = x.getElementsByTagName("source")[0];
    expect(source.getAttribute("xml:lang")).toBe("en");
    expect(source.textContent).toBe("How are you?");
    const translation = x.getElementsByTagName("translation")[0];
    expect(translation.getAttribute("destination_lang")).toBe("fr");
    // §4.3.1：请求中的 translation 必须省略 source_lang
    expect(translation.getAttribute("source_lang")).toBeNull();
  });

  it("语言未确定时显式传 und（schema 要求 xml:lang 必填）", () => {
    const iq = LangTrans.createTranslationRequestIq("translation.shakespeare.lit", {
      text: "How are you?",
      sourceLang: "und",
      targets: [{ destinationLang: "fr" }],
    });

    const x = iq.getElementsByTagNameNS(LangTrans.NS.BASE, "x")[0];
    expect(x.getElementsByTagName("source")[0].getAttribute("xml:lang")).toBe("und");
  });

  it("请求目标可携带 dictionary（Example 14）及 engine/charset", () => {
    const iq = LangTrans.createTranslationRequestIq("translation.shakespeare.lit", {
      text: "How are you?",
      sourceLang: "en",
      targets: [
        { destinationLang: "fr", dictionary: "medical" },
        { destinationLang: "de", engine: "SYSTRANS", charset: "utf-8" },
      ],
    });

    const translations = iq.getElementsByTagName("translation");
    expect(translations[0].getAttribute("dictionary")).toBe("medical");
    expect(translations[1].getAttribute("engine")).toBe("SYSTRANS");
    expect(translations[1].getAttribute("charset")).toBe("utf-8");
  });

  it("目标语言为空时抛错", () => {
    expect(() =>
      LangTrans.createTranslationRequestIq("translation.shakespeare.lit", {
        text: "How are you?",
        sourceLang: "en",
        targets: [],
      }),
    ).toThrow("至少需要一个目标语言");
  });

  it("createTranslationRequestIq 校验语言标签（含空串）", () => {
    const service = "translation.shakespeare.lit";
    const request = { text: "How are you?", sourceLang: "en", targets: [{ destinationLang: "fr" }] };
    expect(() =>
      LangTrans.createTranslationRequestIq(service, { ...request, sourceLang: "12" }),
    ).toThrow("非法的源语言标签");
    // 空串不是合法的 xs:language，也不能当作自动识别
    expect(() =>
      LangTrans.createTranslationRequestIq(service, { ...request, sourceLang: "" }),
    ).toThrow("源语言标签不能为空");
    expect(() =>
      LangTrans.createTranslationRequestIq(service, {
        ...request,
        targets: [{ destinationLang: "not_a_lang" }],
      }),
    ).toThrow("非法的目标语言标签");
    expect(() =>
      LangTrans.createTranslationRequestIq(service, {
        ...request,
        targets: [{ destinationLang: "" }],
      }),
    ).toThrow("目标语言标签不能为空");
  });

  it("createLangTransEl 与 parseLangTransEl 往返一致", () => {
    const x = LangTrans.createLangTransEl({
      source: { lang: "en", text: "How are you?" },
      translations: [
        {
          destinationLang: "fr",
          sourceLang: "en",
          engine: "MyMT 1.0",
          reviewed: true,
          dictionary: "medical",
          charset: "utf-8",
          text: "Comment allez-vous ?",
        },
      ],
    });

    // 走一次序列化/解析，确认命名空间与属性都落在线上
    const { langTrans } = LangTrans.parseLangTransEl(Parser.parse(x.toXMLString()));
    expect(langTrans).toEqual({
      source: { lang: "en", text: "How are you?" },
      translations: [
        {
          destinationLang: "fr",
          sourceLang: "en",
          engine: "MyMT 1.0",
          reviewed: true,
          dictionary: "medical",
          charset: "utf-8",
          text: "Comment allez-vous ?",
        },
      ],
    });
  });

  it("构造语言对查询 IQ", () => {
    const iq = LangTrans.createItemsQuery("translation.shakespeare.lit");
    expect(iq.getAttribute("type")).toBe("get");
    expect(iq.getAttribute("to")).toBe("translation.shakespeare.lit");
    // 与 Example 8 的 <query/> 一致
    expect(
      iq.getElementsByTagNameNS(LangTrans.NS.ITEMS, "query")[0].toXMLString(),
    ).toBe(`<query xmlns="urn:xmpp:langtrans:items"/>`);
  });

  it("构造 items 项", () => {
    const el = LangTrans.createItemEl({
      sourceLang: "en",
      destinationLang: "fr",
      jid: "translation.shakespeare.lit",
      name: "Shakespeare Translation Service",
      engine: "Translator",
      dictionary: "dict",
      pivotable: true,
    });
    expect(el.toXMLString()).toBe(
      `<item source_lang="en" jid="translation.shakespeare.lit" destination_lang="fr" name="Shakespeare Translation Service" engine="Translator" dictionary="dict" pivotable="true"/>`,
    );
    // 可缺省字段不写出（Example 9 的 <item source_lang='fr' jid='...'/>）
    expect(
      LangTrans.createItemEl({ sourceLang: "fr", jid: "translation.shakespeare.lit", pivotable: false })
        .toXMLString(),
    ).toBe(`<item source_lang="fr" jid="translation.shakespeare.lit"/>`);
  });

  it("解析 items 查询结果（Example 9）", () => {
    const response = Parser.parse(
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

    const items = LangTrans.parseItems(response);
    expect(items).toHaveLength(7);
    expect(items[0]).toEqual({
      sourceLang: "en",
      destinationLang: "fr",
      jid: "translation.shakespeare.lit",
      engine: "SYSTRANS 2005 Release 2",
      pivotable: true,
    });
    expect(items[3].dictionary).toBe("medical");
    expect(items[4].dictionary).toBe("standard");
    expect(items[5].dictionary).toBe("Medical 1.0");
    expect(items[6]).toMatchObject({ sourceLang: "ko", destinationLang: "en" });
  });

  it("items 的 destination_lang 可缺省、pivotable 接受 1/0", () => {
    const query = Parser.parse(
      `<query xmlns="urn:xmpp:langtrans:items">
        <item source_lang="en" jid="translation.shakespeare.lit" pivotable="1" name="Tower of Babel"/>
        <item source_lang="fr" jid="translation.shakespeare.lit" pivotable="0"/>
      </query>`,
    );

    const items = LangTrans.parseItems(query);
    expect(items[0]).toMatchObject({ name: "Tower of Babel", pivotable: true });
    expect(items[0].destinationLang).toBeUndefined();
    expect(items[1].pivotable).toBe(false);
  });

  it("响应缺少 items query 时抛错", () => {
    const response = Parser.parse(`<iq type="result"/>`);
    expect(() => LangTrans.parseItems(response)).toThrow("缺少 query 元素");
  });

  it("语言标签按 xs:language 词法校验", () => {
    const valid = ["en", "zh", "zh-CN", "sr-Latn", "de-CH-1901", "und", "i-klingon", "x-private"];
    const invalid = ["", "en_US", "123", "en-", "-en", "abcdefghi", "en--US", "zh-Hans-123456789"];
    const service = "translation.shakespeare.lit";

    // 词法校验挂在构造请求 IQ 的入口上
    for (const tag of valid) {
      expect(
        () =>
          LangTrans.createTranslationRequestIq(service, {
            text: "How are you?",
            sourceLang: tag,
            targets: [{ destinationLang: "fr" }],
          }),
        tag,
      ).not.toThrow();
    }
    for (const tag of invalid) {
      expect(
        () =>
          LangTrans.createTranslationRequestIq(service, {
            text: "How are you?",
            sourceLang: tag,
            targets: [{ destinationLang: "fr" }],
          }),
        tag,
      ).toThrow();
    }
  });
});
