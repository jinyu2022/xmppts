import { XMPPElement } from "@/ltx/Element";
import { Iq } from "@/stanza";
import type { JID } from "@/JID";

/** `<source/>`：待翻译原文 */
export interface LangTransSource {
    /** 源语言（xs:language / BCP 47）；"und" 表示未确定；空串不合法 */
    lang: string;
    /** 原文 */
    text: string;
}

/** `<translation/>`：一条翻译或一个翻译请求目标 */
export interface LangTransTranslation {
    /** 目标语言（xs:language / BCP 47），schema 必填；空串不合法 */
    destinationLang: string;
    /** 源语言（xs:language / BCP 47）；存在即表示这是一条已完成的翻译；空串不合法 */
    sourceLang?: string;
    /**
     * 翻译引擎名：省略 = 人工翻译；空串 = 机器翻译但引擎名不可用；
     * 与 reviewed 同时出现 = 机器翻译经人工复核
     */
    engine?: string;
    /** 是否经人工复核，缺省 false */
    reviewed?: boolean;
    /** 翻译引擎使用的词典名称（自由文本） */
    dictionary?: string;
    /** 翻译源文本使用的字符集名称 */
    charset?: string;
    /** 译文；消息投递中的 `<translation/>` 为空元素，服务响应中才有 */
    text?: string;
}

/** `<x xmlns='urn:xmpp:langtrans'/>` 的解析结果 */
export interface LangTransData {
    /** 待翻译原文；仅翻译请求与翻译响应中出现 */
    source?: LangTransSource;
    /**
     * 翻译描述列表：请求与响应中每个元素是一个独立的目标语言（§4.3.2，一次请求多种语言）；
     * 消息投递中多个元素也可以表达 pivot 链，此时数组顺序即 pivot 顺序（§4.1.2）
     */
    translations: LangTransTranslation[];
}

/** 翻译请求中的目标项；按 XEP-0171 §4.3.1 不写 source_lang */
export interface LangTransTarget {
    /** 目标语言（xs:language / BCP 47），构造时校验，不能为空 */
    destinationLang: string;
    /** 指定翻译引擎名 */
    engine?: string;
    /** 指定翻译引擎的词典名称 */
    dictionary?: string;
    /** 指定源文本字符集 */
    charset?: string;
}

/** `requestTranslation()` 的入参 */
export interface LangTransRequest {
    /** 待翻译原文 */
    text: string;
    /**
     * 源语言（xs:language / BCP 47），必填：schema 要求 `<source/>` 的 `xml:lang` 必须存在。
     * 语言未确定时传 `"und"`，服务端应启用自动语种识别，并在响应的 `<translation/>`
     * 中标注识别出的语言，而不是原样回 `und`。空串不合法。
     */
    sourceLang: string;
    /** 目标语言列表，至少一项；一次可请求多种语言，各项相互独立（§4.3.2） */
    targets: LangTransTarget[];
}

/** `langtrans:items` 查询结果中的一项 */
export interface LangTransItem {
    /** 源语言（xs:language / BCP 47），schema 要求必填；服务端声明能力时不能为空 */
    sourceLang: string;
    /** 目标语言（xs:language / BCP 47）；items schema 未标 required；提供时不能为空 */
    destinationLang?: string;
    /** 提供该语言对的服务 JID，schema 必填 */
    jid: string;
    /** 服务显示名 */
    name?: string;
    /** 翻译引擎名 */
    engine?: string;
    /** 翻译引擎使用的词典名称 */
    dictionary?: string;
    /** 是否可作为 pivot（中转语言），缺省 false */
    pivotable: boolean;
}

/**
 * XEP-0171 纯工具类：命名空间常量、`<x/>` / items 报文的解析与构造。
 * @see https://xmpp.org/extensions/xep-0171.html
 * @version 1.1.1 (2015-10-15)
 */
export class LangTrans {
    static readonly NS = {
        BASE: "urn:xmpp:langtrans",
        ITEMS: "urn:xmpp:langtrans:items",
    } as const;

    /** xs:language 的词法规则（XML Schema Part 2） */
    private static readonly LANGUAGE_TAG_RE = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;

    /**
     * 解析 `xs:boolean` 属性值
     * @param value 属性值；缺失时为 null
     * @returns 仅 "true" / "1" 为 true（XEP-0171 附录 G 注 3）
     */
    private static parseBoolean(value: string | null): boolean {
        return value === "true" || value === "1";
    }

    /**
     * 校验语言标签；空串与不符合 `xs:language` 词法的值都会抛错
     * @param value 语言标签
     * @param role 用于错误提示的角色描述，如“源”“目标”
     * @throws 语言标签为空，或不符合 `xs:language` 词法
     */
    protected static assertLanguageTag(value: string, role: string): void {
        // 空串不满足 xs:language 词法，也不能约定为“自动识别”
        if (!value) {
            throw new Error(`${role}语言标签不能为空`);
        }
        if (!LangTrans.LANGUAGE_TAG_RE.test(value)) {
            throw new Error(`非法的${role}语言标签: ${value}`);
        }
    }

    /**
     * 解析 `<x xmlns='urn:xmpp:langtrans'/>`
     * @param x langtrans 命名空间的 `<x/>` 元素
     * @returns 合并到 stanza 实例上的 `langTrans` 字段
     * @throws 传入元素不属于 langtrans 命名空间
     */
    static parseLangTransEl(x: XMPPElement): { langTrans: LangTransData } {
        if (x.namespaceURI !== LangTrans.NS.BASE) {
            throw new Error("不是一个 langtrans 元素");
        }
        let source: LangTransSource | undefined;
        const translations: LangTransTranslation[] = [];
        for (const child of x.children) {
            if (child.namespaceURI !== LangTrans.NS.BASE) continue;
            if (child.localName === "source") {
                // schema 要求 xml:lang 必填，按对端合规直接取值
                source ??= {
                    lang: child.getAttribute("xml:lang")!,
                    text: child.textContent,
                };
            } else if (child.localName === "translation") {
                translations.push(LangTrans.parseTranslationEl(child));
            }
        }
        return { langTrans: source ? { source, translations } : { translations } };
    }

    /**
     * 解析单个 `<translation/>`
     * @param el langtrans 命名空间的 `<translation/>` 元素
     */
    private static parseTranslationEl(el: XMPPElement): LangTransTranslation {
        const translation: LangTransTranslation = {
            // schema 要求 destination_lang 必填，按对端合规直接取值
            destinationLang: el.getAttribute("destination_lang")!,
            reviewed: LangTrans.parseBoolean(el.getAttribute("reviewed")),
        };
        // 属性存在与否有语义（缺省 source_lang 表示请求），不能用真值判断
        const sourceLang = el.getAttribute("source_lang");
        if (sourceLang !== null) translation.sourceLang = sourceLang;
        const engine = el.getAttribute("engine");
        if (engine !== null) translation.engine = engine;
        const dictionary = el.getAttribute("dictionary");
        if (dictionary !== null) translation.dictionary = dictionary;
        const charset = el.getAttribute("charset");
        if (charset !== null) translation.charset = charset;
        const text = el.textContent;
        if (text) translation.text = text;
        return translation;
    }

    /**
     * 解析 `<query xmlns='urn:xmpp:langtrans:items'/>` 中的语言对
     * @param el items 命名空间的 `<query/>`，或包含它的响应节
     * @returns 语言对列表
     * @throws 找不到 items 命名空间的 `<query/>`
     */
    static parseItems(el: XMPPElement): LangTransItem[] {
        const query = el.namespaceURI === LangTrans.NS.ITEMS && el.localName === "query"
            ? el
            : el.getElementsByTagNameNS(LangTrans.NS.ITEMS, "query")[0];
        if (!query) {
            throw new Error(`langtrans:items 响应缺少 query 元素: ${el.toXMLString()}`);
        }
        const items: LangTransItem[] = [];
        for (const child of query.children) {
            if (child.namespaceURI !== LangTrans.NS.ITEMS || child.localName !== "item") continue;
            // schema 要求 source_lang 与 jid 必填，按对端合规直接取值
            const item: LangTransItem = {
                sourceLang: child.getAttribute("source_lang")!,
                jid: child.getAttribute("jid")!,
                pivotable: LangTrans.parseBoolean(child.getAttribute("pivotable")),
            };
            const destinationLang = child.getAttribute("destination_lang");
            if (destinationLang !== null) item.destinationLang = destinationLang;
            const name = child.getAttribute("name");
            if (name !== null) item.name = name;
            const engine = child.getAttribute("engine");
            if (engine !== null) item.engine = engine;
            const dictionary = child.getAttribute("dictionary");
            if (dictionary !== null) item.dictionary = dictionary;
            items.push(item);
        }
        return items;
    }

    /**
     * 构造 `<x xmlns='urn:xmpp:langtrans'/>`
     * @param data 待构造的翻译描述
     * @returns langtrans 命名空间的 `<x/>`
     */
    static createLangTransEl(data: LangTransData): XMPPElement {
        const x = XMPPElement.createElementNS(LangTrans.NS.BASE, "x");
        if (data.source) {
            const source = XMPPElement.createElement("source");
            source.setAttribute("xml:lang", data.source.lang);
            source.textContent = data.source.text;
            x.appendChild(source);
        }
        for (const translation of data.translations) {
            x.appendChild(LangTrans.createTranslationEl(translation));
        }
        return x;
    }

    /**
     * 构造 `<translation/>`
     * @param t 翻译描述
     * @returns langtrans 命名空间的 `<translation/>`
     */
    static createTranslationEl(t: LangTransTranslation): XMPPElement {
        const el = XMPPElement.createElement("translation");
        el.setAttribute("destination_lang", t.destinationLang);
        if (t.sourceLang !== undefined) el.setAttribute("source_lang", t.sourceLang);
        if (t.engine !== undefined) el.setAttribute("engine", t.engine);
        if (t.dictionary !== undefined) el.setAttribute("dictionary", t.dictionary);
        if (t.charset !== undefined) el.setAttribute("charset", t.charset);
        // schema 缺省 false，只在 true 时写出
        if (t.reviewed) el.setAttribute("reviewed", "true");
        if (t.text !== undefined) el.textContent = t.text;
        return el;
    }

    /**
     * 构造 items 查询结果中的 `<item/>`，未挂载，由调用方放入 `<query xmlns='urn:xmpp:langtrans:items'/>
     * @param item 语言对
     * @returns items 命名空间下的 `<item/>` 元素
     */
    static createItemEl(item: LangTransItem): XMPPElement {
        const el = XMPPElement.createElement("item");
        el.setAttribute("source_lang", item.sourceLang);
        el.setAttribute("jid", item.jid);
        if (item.destinationLang !== undefined) {
            el.setAttribute("destination_lang", item.destinationLang);
        }
        if (item.name !== undefined) el.setAttribute("name", item.name);
        if (item.engine !== undefined) el.setAttribute("engine", item.engine);
        if (item.dictionary !== undefined) el.setAttribute("dictionary", item.dictionary);
        if (item.pivotable) el.setAttribute("pivotable", "true");
        return el;
    }

    /**
     * 构造翻译请求 IQ（XEP-0171 §4.3.1）
     * @param service 翻译服务 JID
     * @param request 翻译请求
     * @returns `type="get"` 的 IQ
     * @throws 目标语言列表为空，或语言标签非法
     */
    static createTranslationRequestIq(
        service: string | JID,
        request: LangTransRequest,
    ): XMPPElement {
        if (request.targets.length === 0) {
            throw new Error("翻译请求至少需要一个目标语言");
        }
        // 本端 API 的入参在入口校验，构造方法本身只负责生成元素
        LangTrans.assertLanguageTag(request.sourceLang, "源");
        for (const target of request.targets) {
            LangTrans.assertLanguageTag(target.destinationLang, "目标");
        }
        const iq = Iq.createIq("get", service);
        iq.appendChild(
            LangTrans.createLangTransEl({
                // 源语言必填；语言未确定时由调用方显式传 und
                source: { lang: request.sourceLang, text: request.text },
                translations: request.targets,
            }),
        );
        return iq;
    }

    /**
     * 构造语言对查询 IQ（XEP-0171 §4.2.3）
     * @param service 翻译服务 JID
     * @returns `type="get"`、载荷为 `<query xmlns='urn:xmpp:langtrans:items'/>` 的 IQ
     */
    static createItemsQuery(service: string | JID): XMPPElement {
        return Iq.createIq("get", service, LangTrans.NS.ITEMS);
    }
}
