import type Connection from "@/connection";
import type { Plugin } from "../types";
import { XMPPElement } from "@/ltx/Element";
import { Iq } from "@/stanza";
import { XMPPError, ErrorConditions, type ErrorTypes } from "@/errors";
import { LangTrans } from "./langtrans";
import type {
    LangTransData,
    LangTransItem,
    LangTransRequest,
    LangTransSource,
    LangTransTranslation,
} from "./langtrans";
import type { JID } from "@/JID";
import logger from "@/log";

const log = logger.getLogger("XEP0171");

/** `provider.translate` 的入参，每个目标语言调用一次 */
export interface LangTransTask {
    /** 发起请求的完整 JID；插件不校验来源，需要授权时由回调据此拒绝 */
    from: string;
    /** 待翻译原文 */
    text: string;
    /** 请求声明的源语言（xs:language / BCP 47）；"und" 表示未确定，引擎应自动识别并通过返回值的 sourceLang 上报 */
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

/** `provider.translate` 的返回值：成功为译文描述，失败为错误条件 */
export type LangTransResult = LangTransResultDetail | LangTransFailureResult;

export interface LangTransResultDetail {
    /** 译文 */
    text: string;
    /** 实际使用的源语言；请求为 "und" 时应填识别出的语言，省略时按请求的 sourceLang 回填 */
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

/** 翻译失败：直接对应 RFC 6120 `<error/>` 节的 condition、type 与 `<text/>` */
export interface LangTransFailureResult {
    /** stanza 错误条件（RFC 6120 §8.3.3） */
    condition: (typeof ErrorConditions)[number];
    /** `<error/>` 的 type（RFC 6120 §8.3.2）；§8.3.3 只给出推荐值，允许按情况另行选择 */
    type: ErrorTypes;
    /** 回给请求方的 `<text/>`；省略则不写，不要放内部细节 */
    text?: string;
}


/** 提供方配置的语言对：语言标签不能为空；jid 缺省填本端 bare JID，pivotable 缺省 false */
export interface LangTransItemConfig {
    /** 源语言（xs:language / BCP 47），必填且不能为空 */
    sourceLang: string;
    /** 目标语言（xs:language / BCP 47）；省略时不写该属性，提供时不能为空 */
    destinationLang?: string;
    /** 提供该语言对的服务 JID */
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

/** 翻译服务提供方（机器人）配置 */
export interface LangTransProvider {
    /**
     * 翻译回调，按目标语言逐个并行调用。
     * 成功返回译文描述，失败返回 `{ condition, type }`；抛出的异常按 internal-server-error 处理。
     */
    translate: (task: LangTransTask) => LangTransResult | Promise<LangTransResult>;
    /** 回调未返回 engine 时的默认值：省略 = ""（机器翻译、名称不可用）；null = 人工翻译 */
    engineName?: string | null;
    /**
     * 支持的语言对，用于应答 langtrans:items；数组或按请求方完整 JID 计算的同步函数。
     * 每项语言标签都会校验，空串不是自动识别的约定。
     */
    languages?: LangTransItemConfig[] | ((from: string) => LangTransItemConfig[]);
    /** translate 回调超时（毫秒）；超时按 item-not-found 应答；0 或省略表示不限时 */
    timeoutMs?: number;
    /** 是否在 宣告 urn:xmpp:langtrans 与 automation/translation
     * 私有服务通常不宣告
     */
    advertise?: boolean;
}

/** registerPlugin("XEP0171", options) 的配置 */
export interface XEP0171Options {
    /** 翻译服务提供方配置；缺省不提供翻译服务 */
    provider?: LangTransProvider;
}

/**
 * XEP-0171: Language Translation（语言翻译）
 *
 * 默认是请求方：解析消息中的翻译描述，向翻译服务发起 IQ 请求。
 * 传入 provider 后同时作为翻译服务提供方应答请求。
 * @see https://xmpp.org/extensions/xep-0171.html
 * @version 1.1.1 (2015-10-15)
 */
class XEP0171 extends LangTrans implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    readonly connection: Connection;
    private readonly provider?: LangTransProvider;

    constructor(connection: Connection, options?: XEP0171Options) {
        super();
        this.connection = connection;
        this.provider = options?.provider;
    }

    init() {
        // 请求方与提供方都需要解析消息/响应中的 <x xmlns='urn:xmpp:langtrans'/>
        this.connection.registerStanzaPlugin(XEP0171.NS.BASE, XEP0171.parseLangTransEl);
        const provider = this.provider;
        if (!provider) return; // 如果不启用服务端功能，下面的全部跳过

        const disco = this.connection.XEP0030!;
        if (provider.advertise !== false) {
            disco.addFeature(XEP0171.NS.BASE);
            disco.addIdentity("automation", "translation");
        }
        this.connection.on("iq", (iq) => this.handleIq(iq));
    }

    /**
     * 请求翻译服务翻译一段文本（XEP-0171 §4.3.1）
     * @param service 翻译服务 JID
     * @param request 翻译请求
     * @returns 服务返回的翻译描述
     * @throws {XMPPError} 服务返回错误 IQ
     */
    async requestTranslation(
        service: string | JID,
        request: LangTransRequest,
    ): Promise<LangTransData> {
        const response = await this.connection.sendAsync(
            XEP0171.createTranslationRequestIq(service, request),
        );
        if (response.getAttribute("type") === "error") {
            throw new XMPPError(response, "翻译请求失败");
        }
        const x = response.getElementsByTagNameNS(XEP0171.NS.BASE, "x")[0];
        if (!x) {
            throw new Error(`翻译响应缺少 langtrans 元素: ${response.toXMLString()}`);
        }
        return XEP0171.parseLangTransEl(x).langTrans;
    }

    /**
     * 查询翻译服务支持的语言对（XEP-0171 §4.2.3）
     * @param service 翻译服务 JID
     * @returns 语言对列表
     * @throws {XMPPError} 服务返回错误 IQ
     */
    async discoverLanguages(service: string | JID): Promise<LangTransItem[]> {
        const response = await this.connection.sendAsync(
            XEP0171.createItemsQuery(service),
        );
        if (response.getAttribute("type") === "error") {
            throw new XMPPError(response, "查询翻译服务语言失败");
        }
        return XEP0171.parseItems(response);
    }

    /**
     * 处理 IQ get：分派给语言对查询或翻译请求
     * @param iq 收到的 IQ
     */
    private async handleIq(iq: Iq): Promise<void> {
        if (!this.provider || iq.type !== "get") return;
        const query = iq.xml.getElementsByTagNameNS(XEP0171.NS.ITEMS, "query")[0];
        if (query) {
            this.handleItemsQuery(iq, query);
            return;
        }
        const x = iq.xml.getElementsByTagNameNS(XEP0171.NS.BASE, "x")[0];
        if (x) await this.handleTranslateRequest(iq, x);
    }

    /**
     * 应答 langtrans:items 查询
     * @param iq 收到的 IQ
     * @param query 请求中的 items `<query/>`
     */
    private handleItemsQuery(iq: Iq, query: XMPPElement): void {
        log.debug(`收到 langtrans:items 查询 from=${iq.from.full}`);
        try {
            const items = this.resolveLanguages(iq, this.connection.jid.bare);
            this.replyItems(iq, items);
        } catch (error) {
            log.warn("应答 langtrans:items 查询失败", error);
            this.replyError(iq, query, "internal-server-error", "cancel");
        }
    }

    /**
     * 应答翻译请求
     * @param iq 收到的 IQ
     * @param x 请求中的 langtrans `<x/>`
     */
    private async handleTranslateRequest(iq: Iq, x: XMPPElement): Promise<void> {
        const { langTrans } = XEP0171.parseLangTransEl(x);
        // 只记长度，不记原文，避免在日志中落隐私内容
        log.debug(
            "收到翻译请求",
            () =>
                `from=${iq.from.full}` +
                ` sourceLang=${String(langTrans.source?.lang)}` +
                ` targets=[${langTrans.translations.map((t) => t.destinationLang).join(",")}]` +
                ` textLength=${String(langTrans.source?.text.length)}`,
        );
        // 缺 source 无法确定原文；带 source_lang 的 translation 不是请求；没有目标也无从翻译
        if (
            !langTrans.source ||
            langTrans.translations.length === 0 ||
            langTrans.translations.some((t) => t.sourceLang !== undefined)
        ) {
            this.replyError(iq, x, "bad-request", "modify");
            return;
        }

        const outcome = await this.translateAll(
            iq,
            langTrans.source,
            langTrans.translations,
        );
        if (!Array.isArray(outcome)) {
            // 每个失败的译文目标都要能定位，日志带请求上下文；应答只用最先失败的条件
            log.warn(
                `翻译请求处理失败 from=${iq.from.full}` +
                ` sourceLang=${langTrans.source.lang} condition=${outcome.condition}`,
            );
            this.replyError(iq, x, outcome.condition, outcome.type, outcome.text);
            return;
        }

        this.replyResult(iq, langTrans.source, outcome);
    }

    /**
     * 解析提供方配置的语言对
     * @param iq 查询 IQ，用于取请求方完整 JID
     * @param selfJid 本端 bare JID，作为 item 的缺省 jid
     * @throws languages 回调抛错或语言标签非法
     */
    private resolveLanguages(
        iq: Iq,
        selfJid: string,
    ): LangTransItem[] {
        const provider = this.provider!;
        const configured = typeof provider.languages === "function"
            ? provider.languages(iq.from.full)
            : provider.languages ?? [];
        return configured.map((item) => {
            // 外部配置不可信：语言标签在进入报文前校验，非法时由调用方的 catch 回 internal-server-error
            XEP0171.assertLanguageTag(item.sourceLang, "源");
            if (item.destinationLang !== undefined) {
                XEP0171.assertLanguageTag(item.destinationLang, "目标");
            }
            return {
                sourceLang: item.sourceLang,
                destinationLang: item.destinationLang,
                jid: item.jid ?? selfJid,
                name: item.name,
                engine: item.engine,
                dictionary: item.dictionary,
                pivotable: item.pivotable ?? false,
            };
        });
    }

    /**
     * 按目标语言并行调用 provider.translate，并整理成响应中的 `<translation/>`
     * @param iq 请求 IQ
     * @param source 请求的原文
     * @param targets 请求的目标列表
     * @returns 全部成功时为各目标的翻译描述；任一失败时按请求顺序返回第一个失败
     */
    private async translateAll(
        iq: Iq,
        source: LangTransSource,
        targets: LangTransTranslation[],
    ): Promise<LangTransTranslation[] | LangTransFailureResult> {
        // 每个目标在 translate 内独立计时，这里只负责汇总
        const outcomes = await Promise.all(
            targets.map((target) => this.translate(iq, source, target)),
        );

        // IQ 只能是 result 或 error：按请求顺序取第一个失败，其余目标不再参与应答
        const translations: LangTransTranslation[] = [];
        for (const outcome of outcomes) {
            if ("condition" in outcome) {
                log.warn(
                    `翻译目标失败 from=${iq.from.full}` +
                    ` sourceLang=${source.lang} condition=${outcome.condition}`,
                );
                return outcome;
            }
            translations.push(outcome);
        }
        return translations;
    }

    /**
     * 翻译单个目标语言，并把回调结果归一化
     * @param iq 请求 IQ
     * @param source 请求的原文
     * @param target 目标语言与相关参数
     * @returns 成功为响应中的一条翻译描述，失败为 stanza 错误条件
     */
    private async translate(
        iq: Iq,
        source: LangTransSource,
        target: LangTransTranslation,
    ): Promise<LangTransTranslation | LangTransFailureResult> {
        const provider = this.provider!;
        const timeoutMs = provider.timeoutMs ?? 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: LangTransResult;
        try {
            const work = Promise.resolve(
                provider.translate({
                    from: iq.from.full,
                    text: source.text,
                    sourceLang: source.lang,
                    destinationLang: target.destinationLang,
                    dictionary: target.dictionary,
                    charset: target.charset,
                    engine: target.engine,
                }),
            );
            // timeoutMs 为 0 或省略时不限时
            result = timeoutMs > 0
                ? await Promise.race([
                    work,
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () => reject(new DOMException("翻译回调超时", "TimeoutError")),
                            timeoutMs,
                        );
                        timer.unref?.();
                    }),
                ])
                : await work;
        } catch (error) {
            // 超时按无法完成翻译处理：正文要求 item-not-found（RFC 6120 §8.3.3.7 规定其 type 为 cancel）
            if (error instanceof DOMException && error.name === "TimeoutError") {
                log.warn("翻译回调超时", error);
                return { condition: "item-not-found", type: "cancel" };
            }
            // 外部回调不可信：抛错也要给出回执，按 internal-server-error 处理
            log.error("翻译回调抛出异常", error);
            return { condition: "internal-server-error", type: "cancel" };
        } finally {
            clearTimeout(timer);
        }
        if (typeof result !== "object" || result === null) {
            log.error("翻译回调返回值无效", result);
            return { condition: "internal-server-error", type: "cancel" };
        }
        if ("condition" in result) return result;
        // 返回值的形状不可信（JS 调用方）：缺 text 无法构造译文
        if (typeof result.text !== "string") {
            log.error("翻译回调返回值缺少 text", result);
            return { condition: "internal-server-error", type: "cancel" };
        }
        // 返回的源语言会原样写入应答，同样先校验；空串不属于自动识别约定
        if (result.sourceLang !== undefined) {
            try {
                XEP0171.assertLanguageTag(result.sourceLang, "源");
            } catch (error) {
                log.error("翻译回调返回的语言标签非法", error);
                return { condition: "internal-server-error", type: "cancel" };
            }
        }

        // 返回值优先；省略时用 engineName（undefined 再缺省 ""）；null 表示人工翻译
        const fallbackEngine =
            provider.engineName === undefined ? "" : provider.engineName;
        const engine = result.engine !== undefined ? result.engine : fallbackEngine;
        const translation: LangTransTranslation = {
            destinationLang: target.destinationLang,
            sourceLang: result.sourceLang ?? source.lang,
            reviewed: result.reviewed ?? false,
            text: result.text,
        };
        if (engine !== null) translation.engine = engine;
        const dictionary = result.dictionary ?? target.dictionary;
        if (dictionary !== undefined) translation.dictionary = dictionary;
        const charset = result.charset ?? target.charset;
        if (charset !== undefined) translation.charset = charset;
        log.debug(
            `翻译目标完成 from=${iq.from.full} sourceLang=${translation.sourceLang}` +
            ` destinationLang=${translation.destinationLang}` +
            ` textLength=${result.text.length} engine=${String(translation.engine)}`,
        );
        return translation;
    }

    /**
     * 发送翻译结果；会话已结束时不发送
     * @param request 请求 IQ
     * @param source 请求的原文，原样回显
     * @param translations 各目标的翻译结果
     */
    private replyResult(
        request: Iq,
        source: LangTransSource,
        translations: LangTransTranslation[],
    ): void {
        // 会话已结束（断线或重连中）：请求方收不到应答，构造与发送都无意义
        if (!this.connection.isSessionActive) {
            log.error(`会话已结束，翻译结果未发出 to=${request.from.full} id=${String(request.id)}`);
            return;
        }
        const iq = Iq.createIq("result", request.from.full);
        iq.setAttribute("id", request.id!);
        iq.appendChild(XEP0171.createLangTransEl({ source, translations }));
        this.connection.send(iq);
        log.info(
            "翻译请求完成",
            () =>
                `from=${request.from.full} sourceLang=${source.lang}` +
                ` targets=[${translations.map((t) => t.destinationLang).join(",")}]`,
        );
    }

    /**
     * 发送语言对查询结果；会话已结束时不发送
     * @param request 请求 IQ
     * @param items 配置的语言对
     */
    private replyItems(request: Iq, items: LangTransItem[]): void {
        if (!this.connection.isSessionActive) {
            log.error(`会话已结束，语言对查询结果未发出 to=${request.from.full} id=${String(request.id)}`);
            return;
        }
        const iq = Iq.createIq("result", request.from.full);
        iq.setAttribute("id", request.id!);
        const query = XMPPElement.createElementNS(XEP0171.NS.ITEMS, "query");
        for (const item of items) {
            query.appendChild(XEP0171.createItemEl(item));
        }
        iq.appendChild(query);
        this.connection.send(iq);
        log.debug(`应答 langtrans:items 查询 from=${request.from.full} count=${items.length}`);
    }

    /**
     * 发送错误应答；会话已结束时不发送
     * @param request 请求 IQ
     * @param payload 请求载荷，按 RFC 6120 §8.3.1 原样回显
     * @param condition stanza 错误条件（RFC 6120 §8.3.3）
     * @param type `<error/>` 的 type（RFC 6120 §8.3.2）
     * @param text 回给请求方的 `<text/>`，省略则不写
     */
    private replyError(
        request: Iq,
        payload: XMPPElement,
        condition: LangTransFailureResult["condition"],
        type: ErrorTypes,
        text?: string,
    ): void {
        if (!this.connection.isSessionActive) {
            log.error(`会话已结束，错误应答未发出 to=${request.from.full} id=${String(request.id)}`);
            return;
        }
        const iq = Iq.createIq("error", request.from.full);
        iq.setAttribute("id", request.id!);
        // 复制请求载荷：同一 stanza 还会派发给其他监听器，不能把原 `<x/>` 移走
        iq.appendChild(payload.cloneNode(true));
        const error = XMPPElement.createElement("error", { type });
        error.appendChild(XMPPElement.createElementNS(XMPPError.NS, condition));
        if (text) {
            const textEl = XMPPElement.createElementNS(XMPPError.NS, "text");
            textEl.textContent = text;
            error.appendChild(textEl);
        }
        iq.appendChild(error);
        this.connection.send(iq);
    }
}

declare module "../../stanza" {
    interface Message {
        langTrans?: LangTransData;
    }

    interface Iq {
        langTrans?: LangTransData;
    }
}

export default XEP0171;
