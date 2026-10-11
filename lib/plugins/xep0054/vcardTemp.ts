import { XMPPElement } from "@/ltx/Element";
import logger from "@/log";

const log = logger.getLogger("XEP0054");

/** TEL 的类型指示空元素白名单（XEP-0054 §9 DTD） */
const TEL_TYPES = [
    "HOME",
    "WORK",
    "VOICE",
    "FAX",
    "PAGER",
    "MSG",
    "CELL",
    "VIDEO",
    "BBS",
    "MODEM",
    "ISDN",
    "PCS",
    "PREF",
] as const;

/** ADR / LABEL 的类型指示空元素白名单（XEP-0054 §9 DTD） */
const ADR_TYPES = [
    "HOME",
    "WORK",
    "POSTAL",
    "PARCEL",
    "DOM",
    "INTL",
    "PREF",
] as const;

/** EMAIL 的类型指示空元素白名单（XEP-0054 §9 DTD） */
const EMAIL_TYPES = ["HOME", "WORK", "INTERNET", "PREF", "X400"] as const;

/** CLASS 取值白名单（XEP-0054 §9 DTD） */
const CLASSES = ["PUBLIC", "PRIVATE", "CONFIDENTIAL"] as const;

type TelType = typeof TEL_TYPES[number];
type AdrType = typeof ADR_TYPES[number];
type EmailType = typeof EMAIL_TYPES[number];
type VCardClass = typeof CLASSES[number];

/**
 * XEP-0054: vcard-temp
 * @see https://xmpp.org/extensions/xep-0054.html
 * @version 1.3.0 (2024-06-27)
 *
 * 已被 XEP-0292 取代，保留供 XEP-0153 / XEP-0486 复用
 */
export class VCardTemp {
    static readonly NS = 'vcard-temp' as const;
    /** §8 实现说明：版本信息写成 version 属性，取值 "3.0" */
    static readonly VERSION = '3.0' as const;

    /**
     * 解析 vCard（XEP-0054 §9 DTD）
     * @param el 命名空间为 vcard-temp 的 vCard 元素
     * @returns 解析后的 vCard 对象，未出现的字段为 undefined
     */
    static parseVCard(el: XMPPElement): VCard {
        if (el.namespaceURI !== VCardTemp.NS) throw new Error("不是一个vCard元素");

        const text = (tag: string, parent: XMPPElement = el) =>
            parent.querySelector(`:scope > ${tag}`)?.textContent;
        const texts = (tag: string, parent: XMPPElement = el) =>
            Array.from(parent.querySelectorAll(`:scope > ${tag}`)).map(
                (child) => child.textContent
            );
        /** 取类型指示空元素，非规范的 <TYPE> 文本元素告警 */
        const types = <T extends string>(parent: XMPPElement, allowed: readonly T[]): T[] | undefined => {
            const list: T[] = [];
            for (const child of parent.children) {
                if ((allowed as readonly string[]).includes(child.localName)) {
                    list.push(child.localName as T);
                } else if (child.localName === "TYPE") {
                    log.warn(() => `非规范的 <TYPE> 类型指示（应使用空元素）: ${parent.toXMLString()}`);
                }
            }
            return list.length ? list : undefined;
        };
        /** 解析 PHOTO / LOGO：((TYPE, BINVAL) | EXTVAL) */
        const media = (parent: XMPPElement): VCardPhoto | undefined => {
            const extval = text("EXTVAL", parent);
            if (extval !== undefined) return { extval };
            const type = text("TYPE", parent);
            const binval = text("BINVAL", parent);
            if (type === undefined && binval === undefined) return undefined;
            return { type, binval };
        };

        const nEl = el.querySelector(":scope > N") ?? undefined;
        const photoEl = el.querySelector(":scope > PHOTO") ?? undefined;
        const logoEl = el.querySelector(":scope > LOGO") ?? undefined;
        const geoEl = el.querySelector(":scope > GEO") ?? undefined;
        const agentEl = el.querySelector(":scope > AGENT") ?? undefined;
        const orgEl = el.querySelector(":scope > ORG") ?? undefined;
        const categoriesEl = el.querySelector(":scope > CATEGORIES") ?? undefined;
        const soundEl = el.querySelector(":scope > SOUND") ?? undefined;
        const keyEl = el.querySelector(":scope > KEY") ?? undefined;

        const classText = text("CLASS");
        if (classText && !(CLASSES as readonly string[]).includes(classText)) {
            log.warn(`未知的 CLASS 取值: ${classText}`);
        }

        let agent: Agent | undefined;
        if (agentEl) {
            const extval = text("EXTVAL", agentEl);
            if (extval !== undefined) {
                agent = { extval };
            } else {
                const nested = agentEl.querySelector(":scope > vCard");
                if (nested) agent = { vcard: VCardTemp.parseVCard(nested) };
            }
        }

        const org = orgEl && { orgname: text("ORGNAME", orgEl) ?? "", orgunits: texts("ORGUNIT", orgEl) };

        let sound: Sound | undefined;
        if (soundEl) {
            const phonetic = text("PHONETIC", soundEl);
            const binval = text("BINVAL", soundEl);
            const extval = text("EXTVAL", soundEl);
            if (phonetic !== undefined) sound = { phonetic };
            else if (binval !== undefined) sound = { binval };
            else if (extval !== undefined) sound = { extval };
            else sound = {};
        }

        return {
            version: el.getAttribute("version") ?? text("VERSION"),
            fn: text("FN") ?? "",
            n: nEl && {
                family: text("FAMILY", nEl),
                given: text("GIVEN", nEl),
                middle: text("MIDDLE", nEl),
                prefix: text("PREFIX", nEl),
                suffix: text("SUFFIX", nEl),
            },
            nickname: text("NICKNAME"),
            photo: photoEl && media(photoEl),
            bday: text("BDAY"),
            adrs: Array.from(el.querySelectorAll(":scope > ADR")).map((adr) => ({
                type: types(adr, ADR_TYPES),
                poBox: text("POBOX", adr),
                extadd: text("EXTADD", adr),
                street: text("STREET", adr),
                locality: text("LOCALITY", adr),
                region: text("REGION", adr),
                pcode: text("PCODE", adr),
                ctry: text("CTRY", adr),
            })),
            labels: Array.from(el.querySelectorAll(":scope > LABEL")).map((label) => ({
                type: types(label, ADR_TYPES),
                lines: texts("LINE", label),
            })),
            tels: Array.from(el.querySelectorAll(":scope > TEL")).map((tel) => ({
                type: types(tel, TEL_TYPES),
                number: text("NUMBER", tel),
            })),
            emails: Array.from(el.querySelectorAll(":scope > EMAIL")).map((email) => ({
                type: types(email, EMAIL_TYPES),
                userid: text("USERID", email) ?? "",
            })),
            jabberid: text("JABBERID"),
            mailer: text("MAILER"),
            tz: text("TZ"),
            geo: geoEl && { lat: text("LAT", geoEl) ?? "", lon: text("LON", geoEl) ?? "" },
            title: text("TITLE"),
            role: text("ROLE"),
            logo: logoEl && media(logoEl),
            agent,
            org,
            categories: categoriesEl && texts("KEYWORD", categoriesEl),
            note: text("NOTE"),
            prodid: text("PRODID"),
            rev: text("REV"),
            sortString: text("SORT-STRING"),
            sound,
            uid: text("UID"),
            url: text("URL"),
            class: classText as VCardClass | undefined,
            key: keyEl && { type: text("TYPE", keyEl), cred: text("CRED", keyEl) ?? "" },
            desc: text("DESC"),
        };
    }

    /**
     * 构造 vCard 元素（XEP-0054 §9 DTD）
     * @param vcard vCard 对象，值为 undefined 的字段不生成元素
     * @returns 命名空间为 vcard-temp、带 version="3.0" 属性的 vCard 元素
     */
    static createVCard(vcard: VCard) {
        const el = XMPPElement.createElementNS(VCardTemp.NS, "vCard", {
            version: vcard.version ?? VCardTemp.VERSION,
        });

        const append = (tag: string, value?: string, parent: XMPPElement = el) => {
            if (value == null) return;
            const child = XMPPElement.createElement(tag);
            child.textContent = value;
            parent.appendChild(child);
        };
        const appendTypes = (parent: XMPPElement, list?: readonly string[]) => {
            for (const type of list ?? []) parent.appendChild(XMPPElement.createElement(type));
        };
        /** 追加 PHOTO / LOGO：((TYPE, BINVAL) | EXTVAL) */
        const appendMedia = (parent: XMPPElement, tag: string, media: VCardPhoto) => {
            const node = XMPPElement.createElement(tag);
            if (media.extval != null) {
                append("EXTVAL", media.extval, node);
            } else {
                append("TYPE", media.type, node);
                append("BINVAL", media.binval, node);
            }
            parent.appendChild(node);
        };

        append("FN", vcard.fn);
        if (vcard.n) {
            const nEl = XMPPElement.createElement("N");
            append("FAMILY", vcard.n.family, nEl);
            append("GIVEN", vcard.n.given, nEl);
            append("MIDDLE", vcard.n.middle, nEl);
            append("PREFIX", vcard.n.prefix, nEl);
            append("SUFFIX", vcard.n.suffix, nEl);
            el.appendChild(nEl);
        }
        append("NICKNAME", vcard.nickname);
        if (vcard.photo) appendMedia(el, "PHOTO", vcard.photo);
        append("BDAY", vcard.bday);
        for (const adr of vcard.adrs ?? []) {
            const adrEl = XMPPElement.createElement("ADR");
            appendTypes(adrEl, adr.type);
            append("POBOX", adr.poBox, adrEl);
            append("EXTADD", adr.extadd, adrEl);
            append("STREET", adr.street, adrEl);
            append("LOCALITY", adr.locality, adrEl);
            append("REGION", adr.region, adrEl);
            append("PCODE", adr.pcode, adrEl);
            append("CTRY", adr.ctry, adrEl);
            el.appendChild(adrEl);
        }
        for (const label of vcard.labels ?? []) {
            const labelEl = XMPPElement.createElement("LABEL");
            appendTypes(labelEl, label.type);
            for (const line of label.lines) append("LINE", line, labelEl);
            el.appendChild(labelEl);
        }
        for (const tel of vcard.tels ?? []) {
            const telEl = XMPPElement.createElement("TEL");
            appendTypes(telEl, tel.type);
            // NUMBER 在 DTD 中必填，无号码时输出空元素
            append("NUMBER", tel.number ?? "", telEl);
            el.appendChild(telEl);
        }
        for (const email of vcard.emails ?? []) {
            const emailEl = XMPPElement.createElement("EMAIL");
            appendTypes(emailEl, email.type);
            append("USERID", email.userid, emailEl);
            el.appendChild(emailEl);
        }
        append("JABBERID", vcard.jabberid);
        append("MAILER", vcard.mailer);
        append("TZ", vcard.tz);
        if (vcard.geo) {
            const geoEl = XMPPElement.createElement("GEO");
            append("LAT", vcard.geo.lat, geoEl);
            append("LON", vcard.geo.lon, geoEl);
            el.appendChild(geoEl);
        }
        append("TITLE", vcard.title);
        append("ROLE", vcard.role);
        if (vcard.logo) appendMedia(el, "LOGO", vcard.logo);
        if (vcard.agent) {
            const agentEl = XMPPElement.createElement("AGENT");
            if (vcard.agent.extval != null) {
                append("EXTVAL", vcard.agent.extval, agentEl);
            } else if (vcard.agent.vcard) {
                agentEl.appendChild(VCardTemp.createVCard(vcard.agent.vcard));
            }
            el.appendChild(agentEl);
        }
        if (vcard.org) {
            const orgEl = XMPPElement.createElement("ORG");
            append("ORGNAME", vcard.org.orgname, orgEl);
            for (const unit of vcard.org.orgunits ?? []) append("ORGUNIT", unit, orgEl);
            el.appendChild(orgEl);
        }
        if (vcard.categories?.length) {
            const categoriesEl = XMPPElement.createElement("CATEGORIES");
            for (const keyword of vcard.categories) append("KEYWORD", keyword, categoriesEl);
            el.appendChild(categoriesEl);
        }
        append("NOTE", vcard.note);
        append("PRODID", vcard.prodid);
        append("REV", vcard.rev);
        append("SORT-STRING", vcard.sortString);
        if (vcard.sound) {
            const soundEl = XMPPElement.createElement("SOUND");
            if (vcard.sound.phonetic != null) append("PHONETIC", vcard.sound.phonetic, soundEl);
            else if (vcard.sound.binval != null) append("BINVAL", vcard.sound.binval, soundEl);
            else if (vcard.sound.extval != null) append("EXTVAL", vcard.sound.extval, soundEl);
            el.appendChild(soundEl);
        }
        append("UID", vcard.uid);
        append("URL", vcard.url);
        append("CLASS", vcard.class);
        if (vcard.key) {
            const keyEl = XMPPElement.createElement("KEY");
            append("TYPE", vcard.key.type, keyEl);
            append("CRED", vcard.key.cred, keyEl);
            el.appendChild(keyEl);
        }
        append("DESC", vcard.desc);
        return el;
    }
}

/** XEP-0054 §9 DTD 的 vCard 字段全集 */
interface VCard {
    version?: string; // version 属性，缺省 "3.0"
    fn: string; // 格式化姓名，DTD 必填
    n?: N;
    nickname?: string;
    photo?: VCardPhoto;
    bday?: string; // 生日，ISO 8601
    adrs?: Adr[];
    labels?: Label[];
    tels?: Tel[];
    emails?: Email[];
    jabberid?: string;
    mailer?: string;
    tz?: string; // UTC 偏移
    geo?: Geo;
    title?: string;
    role?: string;
    logo?: VCardPhoto;
    agent?: Agent;
    org?: Org;
    categories?: string[]; // KEYWORD 列表
    note?: string;
    prodid?: string;
    rev?: string; // 修订时间，ISO 8601
    sortString?: string; // SORT-STRING
    sound?: Sound;
    uid?: string;
    url?: string;
    class?: VCardClass;
    key?: Key;
    desc?: string;
}

/** vCard 结构化姓名（N） */
interface N {
    family?: string; // 姓
    given?: string; // 名
    middle?: string; // 中间名
    prefix?: string; // 名前缀
    suffix?: string; // 名后缀
}

interface Tel {
    type?: TelType[];
    number?: string; // NUMBER，DTD 必填（无号码时为空元素）
}

interface Adr {
    type?: AdrType[];
    poBox?: string; // POBOX
    extadd?: string; // EXTADD
    street?: string; // STREET
    locality?: string; // LOCALITY
    region?: string; // REGION
    pcode?: string; // PCODE
    ctry?: string; // CTRY
}

interface Email {
    type?: EmailType[];
    userid: string; // USERID，DTD 必填
}

/** 地址标签（LABEL） */
interface Label {
    type?: AdrType[];
    lines: string[]; // LINE，DTD 至少一行
}

interface Org {
    orgname: string; // ORGNAME，DTD 必填
    orgunits?: string[]; // ORGUNIT，可重复
}

/** 二进制媒体内容，供 PHOTO / LOGO 复用 */
interface VCardPhoto {
    type?: string; // TYPE，MIME 类型
    binval?: string; // BINVAL，base64 数据
    extval?: string; // EXTVAL，外部 URI
}

/** 拼音/音频（SOUND） */
interface Sound {
    phonetic?: string; // PHONETIC
    binval?: string; // BINVAL
    extval?: string; // EXTVAL
}

/** 密钥（KEY） */
interface Key {
    type?: string; // TYPE
    cred: string; // CRED，DTD 必填
}

/** 地理位置（GEO） */
interface Geo {
    lat: string; // LAT，DTD 必填
    lon: string; // LON，DTD 必填
}

/** 代理（AGENT） */
interface Agent {
    vcard?: VCard; // 内嵌 vCard
    extval?: string; // EXTVAL
}
