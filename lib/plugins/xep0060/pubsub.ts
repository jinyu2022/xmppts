import { Iq } from "@/stanza";
import { JID } from "@/JID";
import { XMPPElement } from "@/ltx/Element";
import { Form, type Field } from "../xep0004/form";

/* ============================== 类型与常量 ============================== */

/** 订阅状态（§4.2 表3） */
export const PUBSUB_SUBSCRIPTION_STATES = [
    "none",
    "pending",
    "subscribed",
    "unconfigured",
] as const;
export type PubsubSubscriptionState = (typeof PUBSUB_SUBSCRIPTION_STATES)[number];

/** 成员与发布权限（§4.1 表1） */
export const PUBSUB_AFFILIATIONS = [
    "none",
    "member",
    "outcast",
    "owner",
    "publisher",
    "publish-only",
] as const;
export type PubsubAffiliation = (typeof PUBSUB_AFFILIATIONS)[number];

/** 节点类型（§4.4 表5） */
export const PUBSUB_NODE_TYPES = ["leaf", "collection"] as const;
export type PubsubNodeType = (typeof PUBSUB_NODE_TYPES)[number];

/**
 * §16.4.4 注册的 leaf 节点配置（XEP-0068），`#node_config` 表单与 `#publish-options` 前提条件共用；
 * 属性名省略注册用法的 `pubsub#` 前缀，未给出的字段不写出
 */
export interface PubsubNodeConfig {
    /** 谁可以订阅与检索项目（§4.5 表6） */
    accessModel?: "authorize" | "open" | "presence" | "roster" | "whitelist";
    /** 节点内数据的语义类型，通常为载荷命名空间 */
    type?: string;
    /** 节点标题 */
    title?: string;
    /** 节点描述 */
    description?: string;
    /** 联系人 JID 列表 */
    contact?: string[];
    /** 默认语言 */
    language?: string;
    /** 是否持久化项目 */
    persistItems?: boolean;
    /** 最多保留的项目数；`max` 表示不设具体上限 */
    maxItems?: number | "max";
    /** 项目自动清理的秒数；`max` 表示不设具体上限 */
    itemExpire?: number | "max";
    /** 是否投递事件通知 */
    deliverNotifications?: boolean;
    /** 是否在事件通知中携带载荷 */
    deliverPayloads?: boolean;
    /** 事件通知的 message type */
    notificationType?: "normal" | "headline";
    /** 是否只向在线订阅者投递 */
    presenceBasedDelivery?: boolean;
    /** 新订阅时何时补发最后一项（§12.10） */
    sendLastPublishedItem?: "never" | "on_sub" | "on_sub_and_presence";
    /** 谁可以发布项目 */
    publishModel?: "publishers" | "subscribers" | "open";
    /** 节点类型 */
    nodeType?: PubsubNodeType;
    /** 白名单访问模式下允许订阅的 roster 分组 */
    rosterGroupsAllowed?: string[];
    /** 是否允许订阅 */
    subscribe?: boolean;
    /** 订阅是否随订阅者 presence 结束而失效（§12.5） */
    tempsub?: boolean;
    /** 发布者离线时是否清空项目 */
    purgeOffline?: boolean;
    /** 事件回复地址；`none` 见 §12.17 */
    itemreply?: "owner" | "publisher" | "none";
    /** 最大载荷字节数 */
    maxPayloadSize?: number;
    /** 把载荷转换为消息正文的 XSLT 地址 */
    bodyXslt?: string;
    /** 把载荷转换为表单结果的 XSLT 地址 */
    dataformXslt?: string;
    /** 配置变更时是否通知订阅者 */
    notifyConfig?: boolean;
    /** 删除节点时是否通知订阅者 */
    notifyDelete?: boolean;
    /** 撤回项目时是否通知订阅者 */
    notifyRetract?: boolean;
    /** 订阅状态变化时是否通知所有者 */
    notifySub?: boolean;
}

/**
 * pubsub#errors 命名空间下的附加错误条件
 * @see §17.2 模式，`node-full` 见 §7.1.3.4
 */
export const PUBSUB_ERROR_CONDITIONS = [
    "closed-node",
    "configuration-required",
    "invalid-jid",
    "invalid-options",
    "invalid-payload",
    "invalid-subid",
    "item-forbidden",
    "item-required",
    "jid-required",
    "max-items-exceeded",
    "max-nodes-exceeded",
    "node-full",
    "nodeid-required",
    "not-in-roster-group",
    "not-subscribed",
    "payload-too-big",
    "payload-required",
    "pending-subscription",
    "precondition-not-met",
    "presence-subscription-required",
    "subid-required",
    "too-many-subscriptions",
    "unsupported",
    "unsupported-access-model",
] as const;
export type PubsubErrorCondition = (typeof PUBSUB_ERROR_CONDITIONS)[number];

/** 单个 pubsub#errors 附加条件的解析结果（§11、§17.2） */
export type PubsubErrorConditionInfo = 
    | { condition: "unsupported"; feature: string }   // §17.2 模式：feature 必填
    | { condition: Exclude<PubsubErrorCondition, "unsupported">; feature?: never };


/** 订阅条目（§5.6 / §6.1 结果与 §8.8 owner 管理共用） */
export interface PubsubSubscription {
    /** 所属节点，来自 `<subscription/>` 自身或其容器 `<subscriptions/>` */
    node?: string;
    /** 订阅者 JID；服务端未给出时为 undefined，构造请求时必填 */
    jid?: string;
    /** 订阅状态，值域见 §4.2 表3 */
    subscription?: PubsubSubscriptionState;
    /** 订阅 ID，同一 JID 对同一节点多次订阅时用于区分（§6.1.6） */
    subid?: string;
}

/** 成员/权限条目（§5.7 结果与 §8.9 owner 管理共用） */
export interface PubsubAffiliationItem {
    /** 所属节点，来自 `<affiliation/>` 自身或其容器 `<affiliations/>` */
    node?: string;
    /** 目标 JID */
    jid?: string;
    /** 权限，值域见 §4.1 表1 */
    affiliation?: PubsubAffiliation;
}

/** `<items/>` 的解析结果（§6.5.3 检索结果与 §7.1.2 事件通知共用） */
export interface PubsubItems {
    /** 节点 ID */
    node?: string;
    /** 全部 item */
    items: PubsubEventItem[];
    /** 被撤回的 ItemID（§7.2.2.1） */
    retracts: string[];
}

export interface PubsubEventItem {
    id?: string;
    publisher?: string;
    // 根据节点的不同，可能有不同的子元素
    [key: string]: unknown;
}

/** `<event/>` 各分支共有字段 */
interface PubsubEventBase {
    /** 事件所属节点 */
    node?: string;
}

/** `<event/>` 各子元素对应的载荷（§17.3 模式），键即子元素名 */
interface PubsubEventPayloads {
    /** §7.1.2 发布 / §7.2.2.1 撤回；两者均为空表示瞬态通知 */
    items: { items?: PubsubEventItem[]; item?: PubsubEventItem; retracts?: string[] };
    /** XEP-0248 §4：节点加入或移出集合，取 `<associate/>`/`<disassociate/>` 的目标节点 */
    collection: { associate?: string; disassociate?: string };
    /** §8.2.5.3：节点配置变更，`form` 为 `jabber:x:data` 配置表单（原样保留） */
    configuration: { form?: XMPPElement };
    /** §8.4.2：节点删除，`redirect` 为 `<redirect uri/>` 给出的新位置 */
    delete: { redirect?: string };
    /** §8.5.2：节点清空，数据全在 node 属性上，无附加字段 */
    purge: Record<never, never>;
    /** §12.14 订阅状态变更；字段同 `<subscription/>` 属性，`expiry` 为 §12.5 租约到期时间 */
    subscription: {
        jid?: string;
        subid?: string;
        subscription?: PubsubSubscriptionState;
        expiry?: string;
    };
}

/** 事件载荷字段全集：各分支携带字段名的并集 */
type PubsubEventField = {
    [K in keyof PubsubEventPayloads]: keyof PubsubEventPayloads[K];
}[keyof PubsubEventPayloads];

/** 除 K 之外的载荷字段一律不可出现，用于表达 `<event/>` 子元素的互斥 */
type Only<K extends string> = { [P in Exclude<PubsubEventField, K>]?: never };

/** 以子元素名为判别字段的六个事件分支 */
type PubsubEventVariants = {
    [K in keyof PubsubEventPayloads]: { type: K } & PubsubEventPayloads[K] &
        Only<Extract<keyof PubsubEventPayloads[K], string>>;
};

/**
 * `<event/>` 通知（§4.3、§17.3 模式）
 *
 * 六个子元素互斥，故为可判别联合：`type` 即子元素名，`switch` 可穷尽；
 * 子元素内的协议数据已展开为普通字段（如 `delete` 分支的 `redirect`），不再保留元素本身，
 * 需要原始 XML 时见 `message.xml`。未列举的子元素（规范会扩展）归入 `unknown`，只保留 node。
 * 各分支都声明了全部载荷字段（未用到的为 never），因此 `event.item` 一类读取无需先窄化。
 */
export type PubsubEvent = PubsubEventBase &
    (PubsubEventVariants[keyof PubsubEventVariants] | ({ type: "unknown" } & Only<never>));

/* ================================= 主体 ================================= */

/**
 * XEP-0060: Publish-Subscribe
 *
 * 请求构造与响应解析的纯静态工具类，按用例角色分组：
 * 实体（§5）、订阅者（§6）、发布者（§7）、所有者（§8）。
 * 构造器的 `to` 参数位置按族划分：§5/§6/§8 放在首位，§7 放在末位。
 * 节点权限校验、订阅广播、通知投递等属服务端义务，不在此实现。
 * @see https://xmpp.org/extensions/xep-0060.html
 * @version 1.30.0 (2025-11-11)
 */
export class Pubsub {
    static readonly NS = {
        BASE: "http://jabber.org/protocol/pubsub",
        EVENT: "http://jabber.org/protocol/pubsub#event",
        OWNER: "http://jabber.org/protocol/pubsub#owner",
        ERRORS: "http://jabber.org/protocol/pubsub#errors",
    } as const;

    /**
     * 附加数据表单的 FORM_TYPE 取值（XEP-0068）。取值形如命名空间，但标识的是表单类型，与 `NS` 的元素命名空间不同类
     */
    static readonly FORM_TYPE = {
        /** §7.1.5 发布选项表单 */
        PUBLISH_OPTIONS: "http://jabber.org/protocol/pubsub#publish-options",
        /** §8.2 节点配置表单 */
        NODE_CONFIG: "http://jabber.org/protocol/pubsub#node_config",
    } as const;

    /** `PubsubNodeConfig` 属性名 → §16.4.4 注册的字段变量名；键序即表单字段的写出顺序 */
    private static readonly NODE_CONFIG_VARS = {
        accessModel: "pubsub#access_model",
        type: "pubsub#type",
        title: "pubsub#title",
        description: "pubsub#description",
        contact: "pubsub#contact",
        language: "pubsub#language",
        persistItems: "pubsub#persist_items",
        maxItems: "pubsub#max_items",
        itemExpire: "pubsub#item_expire",
        deliverNotifications: "pubsub#deliver_notifications",
        deliverPayloads: "pubsub#deliver_payloads",
        notificationType: "pubsub#notification_type",
        presenceBasedDelivery: "pubsub#presence_based_delivery",
        sendLastPublishedItem: "pubsub#send_last_published_item",
        publishModel: "pubsub#publish_model",
        nodeType: "pubsub#node_type",
        rosterGroupsAllowed: "pubsub#roster_groups_allowed",
        subscribe: "pubsub#subscribe",
        tempsub: "pubsub#tempsub",
        purgeOffline: "pubsub#purge_offline",
        itemreply: "pubsub#itemreply",
        maxPayloadSize: "pubsub#max_payload_size",
        bodyXslt: "pubsub#body_xslt",
        dataformXslt: "pubsub#dataform_xslt",
        notifyConfig: "pubsub#notify_config",
        notifyDelete: "pubsub#notify_delete",
        notifyRetract: "pubsub#notify_retract",
        notifySub: "pubsub#notify_sub",
    } as const satisfies Record<keyof PubsubNodeConfig, string>;

    /**
     * 创建外层结构：`<iq/>` 与指定命名空间的空 `<pubsub/>`
     * @param type iq 类型
     * @param ns pubsub 命名空间（`NS.BASE` 或 `NS.OWNER`）
     * @param to 目标服务 JID；不填表示自己的 PEP 节点
     */
    private static createPubsubIq(type: "get" | "set", ns: string, to?: string | JID) {
        const iq = Iq.createIq(type, to);
        const pubsub = XMPPElement.createElementNS(ns, "pubsub");
        iq.appendChild(pubsub);
        return { iq, pubsub };
    }

    /**
     * 构造 `<options/>`（§6.3）：属性按需写出，可附加订阅选项数据表单
     * @param node 节点 ID；undefined 表示不写 node 属性
     * @param jid 订阅者 JID；undefined 表示不写 jid 属性
     * @param subid 订阅 ID；省略表示不写 subid 属性
     * @param form 数据表单（`jabber:x:data` 的 `<x/>`）
     */
    private static createOptionsEl(
        node: string | undefined,
        jid: string | JID | undefined,
        subid: string | undefined,
        form?: XMPPElement,
    ) {
        const attrs: Record<string, string> = {};
        if (node !== undefined) attrs.node = node;
        if (jid !== undefined) attrs.jid = jid.toString();
        if (subid) attrs.subid = subid;
        const options = XMPPElement.createElement("options", attrs);
        if (form) options.appendChild(form);
        return options;
    }

    /**
     * 构造 `type='submit'` 的数据表单，并在首位写入 hidden 的 FORM_TYPE（XEP-0068）
     * @param formType FORM_TYPE 取值，即 `FORM_TYPE` 常量之一
     * @param fields 表单字段，不含 FORM_TYPE
     */
    private static createSubmitForm(formType: string, fields: Field[]): XMPPElement {
        return Form.createFormEl({
            type: "submit",
            fields: [
                { type: "hidden", var: "FORM_TYPE", values: [formType] },
                ...fields,
            ],
        });
    }

    /**
     * 把节点配置转为表单字段：布尔值写出 `true`/`false`，多值字段展开为多个 `<value/>`，
     * 未给出的属性不写出
     * @param config 节点配置
     */
    private static nodeConfigFields(config: PubsubNodeConfig): Field[] {
        const fields: Field[] = [];
        for (const key of Object.keys(Pubsub.NODE_CONFIG_VARS) as Array<keyof PubsubNodeConfig>) {
            const value = config[key];
            if (value === undefined) continue;
            fields.push({
                var: Pubsub.NODE_CONFIG_VARS[key],
                values: Array.isArray(value) ? value : [String(value)],
            });
        }
        return fields;
    }

    /* ---------------------- 实体用例（§5） ---------------------- */

    /**
     * §5.6 检索订阅列表
     * @param to 服务 JID
     * @param node 省略时检索该服务上全部节点的订阅（§5.6.1）
     */
    static createRetrieveSubscriptionsIq(to: string | JID, node?: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.BASE, to);
        pubsub.appendChild(
            XMPPElement.createElement("subscriptions", node ? { node } : undefined),
        );
        return iq;
    }

    /**
     * §5.7 检索权限列表
     * @param to 服务 JID
     * @param node 省略时检索该服务上全部节点的权限（§5.7.1）
     */
    static createRetrieveAffiliationsIq(to: string | JID, node?: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.BASE, to);
        pubsub.appendChild(
            XMPPElement.createElement("affiliations", node ? { node } : undefined),
        );
        return iq;
    }

    /* --------------------- 订阅者用例（§6） --------------------- */

    /**
     * §6.1.1 订阅节点；§6.3.7 允许在同一条 IQ 中提交订阅选项
     * @param to 服务 JID
     * @param node 节点 ID
     * @param jid 被订阅的 JID，bare 或 full
     * @param form 订阅选项表单；与 `<subscribe/>` 同处时 `<options/>` 必须不带任何属性
     */
    static createSubscribeIq(
        to: string | JID,
        node: string,
        jid: string | JID,
        form?: XMPPElement,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        pubsub.appendChild(XMPPElement.createElement("subscribe", { node, jid: jid.toString() }));
        if (form) pubsub.appendChild(Pubsub.createOptionsEl(undefined, undefined, undefined, form));
        return iq;
    }

    /**
     * §6.2.1 退订节点
     * @param to 服务 JID
     * @param node 节点 ID
     * @param jid 订阅者 JID
     * @param subid 同一 JID 对同一节点多次订阅时必须指定，否则服务返回 `subid-required`（§6.2.3.1）
     */
    static createUnsubscribeIq(
        to: string | JID,
        node: string,
        jid: string | JID,
        subid?: string,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        const attrs: Record<string, string> = { node, jid: jid.toString() };
        if (subid) attrs.subid = subid;
        pubsub.appendChild(XMPPElement.createElement("unsubscribe", attrs));
        return iq;
    }

    /**
     * §6.3.2 检索订阅选项
     * @param to 服务 JID
     * @param node 节点 ID；空字符串表示请求根集合节点的订阅选项（§6.3.4.1）
     * @param jid 订阅者 JID
     * @param subid 同一 JID 多次订阅时必填（§6.3.4.4）
     */
    static createRetrieveSubscriptionOptionsIq(
        to: string | JID,
        node: string,
        jid: string | JID,
        subid?: string,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.BASE, to);
        pubsub.appendChild(Pubsub.createOptionsEl(node, jid, subid));
        return iq;
    }

    /**
     * §6.3.5 提交订阅选项表单
     * @param to 服务 JID
     * @param node 节点 ID
     * @param jid 订阅者 JID
     * @param form `#subscribe_options` 类型的数据表单（`type='submit'`）
     * @param subid 同一 JID 多次订阅时必填
     */
    static createSubmitSubscriptionOptionsIq(
        to: string | JID,
        node: string,
        jid: string | JID,
        form: XMPPElement,
        subid?: string,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        pubsub.appendChild(Pubsub.createOptionsEl(node, jid, subid, form));
        return iq;
    }

    /**
     * §6.4.1 检索默认订阅选项
     * @param to 服务 JID
     * @param node 省略时请求服务级默认值（§6.4.1 Example 70）
     */
    static createDefaultSubscriptionOptionsIq(to: string | JID, node?: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.BASE, to);
        pubsub.appendChild(XMPPElement.createElement("default", node ? { node } : undefined));
        return iq;
    }

    /**
     * §6.5 检索节点项目
     * @param to 服务 JID
     * @param node 节点 ID
     * @param max 最多返回的最近项目数（`max_items`，§6.5.2）；模式中为正整数（§17.1），省略表示全部
     * @param itemIds 要检索的 ItemID 列表
     */
    static createRetrieveItemsIq(
        to: string | JID,
        node: string,
        max?: number,
        itemIds?: string[],
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.BASE, to);
        const items = XMPPElement.createElement("items", { node });
        // max_items 的模式为 xs:positiveInteger（§17.1），非正数按未指定处理
        if (max !== undefined && max > 0) items.setAttribute("max_items", max.toString());
        // §6.5.6 原文「When an entity requests items by ItemID,
    // implementations MUST allow multiple items to be specified in the request」，Example 78 即一次两个 `<item id/>`，因此这里要支持多个
        for (const itemId of itemIds ?? []) {
            items.appendChild(XMPPElement.createElement("item", { id: itemId }));
        }
        pubsub.appendChild(items);
        return iq;
    }

    /* --------------------- 发布者用例（§7） --------------------- */

    /**
     * §7.1.1 构造发布请求
     * @param publish `<publish/>` 元素，含 node 属性与 item；§7.1.1 规定一次至多一个 `<item/>`
     *   （脚注 19：1.13 起移除批量发布，不再允许包含多个 `<item/>`）
     * @param publishOptions `<publish-options/>` 发布选项，内含 `#publish-options` 类型的数据表单（§7.1.5）
     * @param to 发布到哪个服务；不填表示自己的 PEP 节点
     */
    static createPublishIq(
        publish: XMPPElement,
        publishOptions?: XMPPElement,
        to?: string | JID,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        pubsub.appendChild(publish);
        if (publishOptions) pubsub.appendChild(publishOptions);
        return iq;
    }

    /**
     * §7.1.5 构造 `<publish-options/>`，供 `createPublishIq` 使用
     *
     * 每个字段都是一条发布前提条件，服务端会与同名节点配置比对，不满足或出现未知字段时拒绝发布，
     * 故这里只接受 §16.4.4 注册的配置项。FORM_TYPE 与 `type='submit'` 由本方法写入
     * @param config 发布前提条件，省略的属性不作为条件
     */
    static createPublishOptionsEl(config: PubsubNodeConfig) {
        const publishOptions = XMPPElement.createElement("publish-options");
        publishOptions.appendChild(
            Pubsub.createSubmitForm(
                Pubsub.FORM_TYPE.PUBLISH_OPTIONS,
                Pubsub.nodeConfigFields(config),
            ),
        );
        return publishOptions;
    }

    /**
     * §7.2.1 构造撤回请求：`<retract/>` 必须包含一个带 id 的空 `<item/>`
     * @param node 被撤回项目所在的节点 ID
     * @param id 被撤回项目的 ItemID
     * @param notify 只有显式传 `true` 才能要求服务通知订阅者（§7.2.2.1）；省略或传 `false` 不保证通知
     * @param to 目标服务
     */
    static createRetractIq(node: string, id: string, notify?: boolean, to?: string | JID) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        const retract = XMPPElement.createElement("retract", { node });
        if (notify !== undefined) retract.setAttribute("notify", String(notify));
        // §7.2.1：`<retract/>` MUST contain one `<item/>`，该 `<item/>` MUST be empty 且带 'id' 属性
        const item = XMPPElement.createElement("item", { id });
        retract.appendChild(item);
        pubsub.appendChild(retract);
        return iq;
    }

    /* -------------------- 所有者用例（§8，OWNER） -------------------- */

    /**
     * §8.1.2 / §8.1.3 创建节点
     * @param to 服务 JID
     * @param node 节点 ID；省略表示请求即时节点（instant node，§8.1.1），此时服务返回生成的 NodeID
     * @param form `#node_config` 类型的数据表单，用于创建时一并配置；节点类型通过其中的 `pubsub#node_type` 字段给出
     */
    static createNodeIq(to: string | JID, node?: string, form?: XMPPElement) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.BASE, to);
        pubsub.appendChild(XMPPElement.createElement("create", node ? { node } : undefined));
        if (form) {
            const configure = XMPPElement.createElement("configure");
            configure.appendChild(form);
            pubsub.appendChild(configure);
        }
        return iq;
    }

    /**
     * §8.2 构造 `#node_config` 提交表单，供 `createConfigureNodeIq`、`createNodeIq` 使用；
     * 字段限制同 `createPublishOptionsEl`
     * @param config 节点配置，省略的属性不写出
     */
    static createNodeConfigForm(config: PubsubNodeConfig) {
        return Pubsub.createSubmitForm(
            Pubsub.FORM_TYPE.NODE_CONFIG,
            Pubsub.nodeConfigFields(config),
        );
    }

    /**
     * §8.2.1 检索节点配置表单
     * @param to 服务 JID
     * @param node 节点 ID
     */
    static createRetrieveNodeConfigIq(to: string | JID, node: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.OWNER, to);
        pubsub.appendChild(XMPPElement.createElement("configure", { node }));
        return iq;
    }

    /**
     * §8.2.4 提交节点配置表单
     * @param to 服务 JID
     * @param node 节点 ID
     * @param form `#node_config` 类型的数据表单；传 `type='cancel'` 的 `<x/>` 表示放弃本次配置（§8.2.4 Example 147）
     */
    static createConfigureNodeIq(to: string | JID, node: string, form: XMPPElement) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.OWNER, to);
        const configure = XMPPElement.createElement("configure", { node });
        configure.appendChild(form);
        pubsub.appendChild(configure);
        return iq;
    }

    /**
     * §8.3.1 / §8.3.2 检索默认节点配置
     * @param to 服务 JID
     * @param nodeType 节点类型；省略时服务返回 leaf 的默认配置
     */
    static createDefaultNodeConfigIq(to: string | JID, nodeType?: PubsubNodeType) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.OWNER, to);
        pubsub.appendChild(
            XMPPElement.createElement("default", nodeType ? { type: nodeType } : undefined),
        );
        return iq;
    }

    /**
     * §8.4.1 删除节点
     * @param to 服务 JID
     * @param node 节点 ID
     * @param redirectUri 重定向 URI，服务支持时用于告知订阅者节点的新位置（§8.4.1 Example 158）
     */
    static createDeleteNodeIq(to: string | JID, node: string, redirectUri?: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.OWNER, to);
        const del = XMPPElement.createElement("delete", { node });
        if (redirectUri) del.appendChild(XMPPElement.createElement("redirect", { uri: redirectUri }));
        pubsub.appendChild(del);
        return iq;
    }

    /**
     * §8.5.1 清空节点全部项目
     * @param to 服务 JID
     * @param node 节点 ID
     */
    static createPurgeNodeIq(to: string | JID, node: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.OWNER, to);
        pubsub.appendChild(XMPPElement.createElement("purge", { node }));
        return iq;
    }

    /**
     * §8.8.1.1 检索节点的订阅列表
     * @param to 服务 JID
     * @param node 节点 ID
     */
    static createRetrieveNodeSubscriptionsIq(to: string | JID, node: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.OWNER, to);
        pubsub.appendChild(XMPPElement.createElement("subscriptions", { node }));
        return iq;
    }

    /**
     * §8.8.2.1 / §8.8.3 修改订阅：只提交增量，未给出 `subscription` 的条目不会被改动；
     * 将 `subscription` 设为 `none` 即删除该订阅者
     * @param to 服务 JID
     * @param node 节点 ID
     * @param subscriptions 待修改的订阅条目；每条必须给出 `jid`
     */
    static createModifyNodeSubscriptionsIq(
        to: string | JID,
        node: string,
        subscriptions: Array<PubsubSubscription & { jid: string }>,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.OWNER, to);
        const subscriptionsEl = XMPPElement.createElement("subscriptions", { node });
        for (const sub of subscriptions) {
            const attrs: Record<string, string> = { jid: sub.jid };
            if (sub.subscription) attrs.subscription = sub.subscription;
            if (sub.subid) attrs.subid = sub.subid;
            subscriptionsEl.appendChild(XMPPElement.createElement("subscription", attrs));
        }
        pubsub.appendChild(subscriptionsEl);
        return iq;
    }

    /**
     * §8.9.1.1 检索节点的权限列表
     * @param to 服务 JID
     * @param node 节点 ID
     */
    static createRetrieveNodeAffiliationsIq(to: string | JID, node: string) {
        const { iq, pubsub } = Pubsub.createPubsubIq("get", Pubsub.NS.OWNER, to);
        pubsub.appendChild(XMPPElement.createElement("affiliations", { node }));
        return iq;
    }

    /**
     * §8.9.2.1 / §8.9.3 修改权限：只提交增量，未给出 `affiliation` 的条目不会被改动；
     * 将 `affiliation` 设为 `none` 即移除该实体
     * @param to 服务 JID
     * @param node 节点 ID
     * @param affiliations 待修改的权限条目；每条必须给出 `jid`
     */
    static createModifyNodeAffiliationsIq(
        to: string | JID,
        node: string,
        affiliations: Array<PubsubAffiliationItem & { jid: string }>,
    ) {
        const { iq, pubsub } = Pubsub.createPubsubIq("set", Pubsub.NS.OWNER, to);
        const affiliationsEl = XMPPElement.createElement("affiliations", { node });
        for (const item of affiliations) {
            const attrs: Record<string, string> = { jid: item.jid };
            if (item.affiliation) attrs.affiliation = item.affiliation;
            affiliationsEl.appendChild(XMPPElement.createElement("affiliation", attrs));
        }
        pubsub.appendChild(affiliationsEl);
        return iq;
    }

    /* ------------------------- 解析 ------------------------- */

    /**
     * 解析 `<items/>`：按直接子元素取 `<item/>` 与 `<retract/>`
     * @param itemsEl `<items/>` 元素本身；检索结果用 `NS.BASE`（§17.1 模式），
     *                事件通知用 `NS.EVENT`（§17.3 模式）
     */
    static parseItems(itemsEl: XMPPElement): PubsubItems {
        const inBase = itemsEl.namespaceURI === Pubsub.NS.BASE;
        const inEvent = itemsEl.namespaceURI === Pubsub.NS.EVENT;
        if (itemsEl.localName !== "items" || (!inBase && !inEvent))
            throw new Error("不是一个items元素");
        const items = Array.from(itemsEl.querySelectorAll(":scope > item")).map((itemEl) => {
            const item: PubsubEventItem = {
                id: itemEl.getAttribute("id") ?? undefined,
                publisher: itemEl.getAttribute("publisher") ?? undefined,
            };
            // §7.1.3.6、§17.1：一个 item 只携带一个载荷根元素，多根元素属违规
            const payload = itemEl.children.item(0);
            if (payload) item[payload.localName] = payload;
            return item;
        });
        // §7.2.2.1：retract 必须带 id，缺失时无法定位被撤回的项目
        const retracts: string[] = [];
        for (const retractEl of itemsEl.querySelectorAll(":scope > retract")) {
            const id = retractEl.getAttribute("id");
            if (id) retracts.push(id);
        }
        return { node: itemsEl.getAttribute("node") ?? undefined, items, retracts };
    }

    /**
     * 解析 `<event/>` 通知（§4.3、§17.3 模式）：只按 `#event` 命名空间与直接父子关系识别协议元素，
     * 业务载荷内层的同名元素（如 `<note><item/></note>`）不会被当作额外通知项。
     * @param eventEl `<event/>` 元素
     */
    static parseEventEl(eventEl: XMPPElement): { event: PubsubEvent } {
        if (eventEl.namespaceURI !== Pubsub.NS.EVENT)
            throw new Error("不是一个event元素");

        /** 未列举子元素自身的 node */
        let unknownNode: string | undefined;
        for (const child of eventEl.children) {
            if (child.namespaceURI !== Pubsub.NS.EVENT) continue;
            const event = Pubsub.parseEventChild(child);
            if (event) return { event };
            // 未列举的事件元素同样保留 node，避免整条 stanza 的分发被打断
            unknownNode ??= child.getAttribute("node") ?? undefined;
        }
        return { event: { type: "unknown", node: unknownNode } };
    }

    /**
     * 按子元素的 localName 构造对应的事件分支；未列举的子元素返回 undefined
     * @param child `<event/>` 的直接子元素
     */
    private static parseEventChild(child: XMPPElement): PubsubEvent | undefined {
        const childNode = child.getAttribute("node") ?? undefined;
        switch (child.localName) {
            // §7.1.2 / §7.2.2.1：item 与 retract 互斥，两者皆无表示瞬态通知
            case "items": {
                const { items, retracts } = Pubsub.parseItems(child);
                const event: PubsubEvent = {
                    type: "items",
                    node: childNode,
                    ...(items.length ? { items, item: items[0] } : {}),
                    ...(retracts.length ? { retracts } : {}),
                };
                return event;
            }
            // 其余单一事件元素：取各自规范定义的子元素/属性，展开为普通字段
            case "collection": {
                const associate = child.querySelector(":scope > associate")?.getAttribute("node");
                const disassociate = child.querySelector(":scope > disassociate")?.getAttribute("node");
                return {
                    type: "collection",
                    node: childNode,
                    associate: associate ?? undefined,
                    disassociate: disassociate ?? undefined,
                };
            }
            case "configuration":
                return {
                    type: "configuration",
                    node: childNode,
                    form: child.querySelector(":scope > x") ?? undefined,
                };
            case "delete":
                return {
                    type: "delete",
                    node: childNode,
                    redirect: child.querySelector(":scope > redirect")?.getAttribute("uri") ?? undefined,
                };
            case "purge":
                return { type: "purge", node: childNode };
            case "subscription":
                return {
                    type: "subscription",
                    node: childNode,
                    jid: child.getAttribute("jid") ?? undefined,
                    subid: child.getAttribute("subid") ?? undefined,
                    // 不在 §4.2 表 3 中的状态取 undefined
                    subscription: PUBSUB_SUBSCRIPTION_STATES.find(
                        (value) => value === child.getAttribute("subscription"),
                    ),
                    expiry: child.getAttribute("expiry") ?? undefined,
                };
            default:
                return undefined;
        }
    }

    /**
     * 解析 `<subscriptions/>`；也接受订阅/退订响应里直接返回的单个 `<subscription/>`（§6.1.2、§6.2.2）
     * @param subscriptionsEl `<subscriptions/>` 或 `<subscription/>` 元素本身；检索结果用 `NS.BASE`
     *                        （§6.1.1），owner 管理用 `NS.OWNER`（§8.8.2）
     */
    static parseSubscriptions(subscriptionsEl: XMPPElement): PubsubSubscription[] {
        /** `<subscription/>` → 订阅条目；node 缺省取容器上的属性（§5.6.1 Example 21） */
        const parseEl = (subEl: XMPPElement, node?: string): PubsubSubscription => ({
            node: subEl.getAttribute("node") ?? node,
            jid: subEl.getAttribute("jid") ?? undefined,
            // 不在 §4.2 表 3 中的状态取 undefined
            subscription: PUBSUB_SUBSCRIPTION_STATES.find(
                (value) => value === subEl.getAttribute("subscription"),
            ),
            subid: subEl.getAttribute("subid") ?? undefined,
        });

        const isContainer = subscriptionsEl.localName === "subscriptions";
        const isSingle = subscriptionsEl.localName === "subscription";
        const inBase = subscriptionsEl.namespaceURI === Pubsub.NS.BASE;
        const inOwner = subscriptionsEl.namespaceURI === Pubsub.NS.OWNER;
        if ((!isContainer && !isSingle) || (!inBase && !inOwner))
            throw new Error("不是一个subscriptions元素");

        if (isContainer) {
            const node = subscriptionsEl.getAttribute("node") ?? undefined;
            return Array.from(subscriptionsEl.querySelectorAll(":scope > subscription")).map(
                (subEl) => parseEl(subEl, node),
            );
        }
        return [parseEl(subscriptionsEl)];
    }

    /**
     * 解析 `<affiliations/>`（§5.7 与 §8.9.1.2）
     * @param affiliationsEl `<affiliations/>` 元素本身；检索结果用 `NS.BASE`（§5.7），
     *                       owner 管理用 `NS.OWNER`（§8.9.1.2）
     */
    static parseAffiliations(affiliationsEl: XMPPElement): PubsubAffiliationItem[] {
        const inBase = affiliationsEl.namespaceURI === Pubsub.NS.BASE;
        const inOwner = affiliationsEl.namespaceURI === Pubsub.NS.OWNER;
        if (affiliationsEl.localName !== "affiliations" || (!inBase && !inOwner))
            throw new Error("不是一个affiliations元素");
        const node = affiliationsEl.getAttribute("node") ?? undefined;
        return Array.from(affiliationsEl.querySelectorAll(":scope > affiliation")).map((child) => ({
            node: child.getAttribute("node") ?? node,
            jid: child.getAttribute("jid") ?? undefined,
            // 不在 §4.1 表 1 中的权限取 undefined
            affiliation: PUBSUB_AFFILIATIONS.find(
                (value) => value === child.getAttribute("affiliation"),
            ),
        }));
    }

    /**
     * 解析 `<error/>` 下的一个 pubsub#errors 附加条件元素（§11、§17.2）
     *
     * 按命名空间注册给连接（见 `XEP0060.init`）后，条件挂到 `stanza.error.pubsub`：
     * `<unsupported feature="retrieve-items"/>` 得
     * `error.pubsub.condition === "unsupported"`、`error.pubsub.feature === "retrieve-items"`。
     * 通用条件、`type` 与 `text` 由 `StanzaBase` 从同一个 `<error/>` 解析，不在此处重复。
     * @param el pubsub#errors 命名空间下的条件元素本身，如 `<unsupported/>`
     * @throws 命名空间不符
     */
    static parseErrorChildEl(el: XMPPElement): { pubsub: PubsubErrorConditionInfo } {
        if (el.namespaceURI !== Pubsub.NS.ERRORS) throw new Error("不是一个pubsub error元素");
        const condition = el.localName as PubsubErrorCondition;
        // §17.2 模式：feature 属性只出现在 <unsupported/> 上，且为必填
        return {
            pubsub: condition === "unsupported"
                ? { condition, feature: el.getAttribute("feature")! }
                : { condition },
        };
    }
}

declare module "@/stanza" {
    interface Message {
        /**XEP0060 */
        event?: PubsubEvent;
    }
}

declare module "@/errors" {
    interface StanzaError {
        /** XEP0060：`pubsub#errors` 附加条件（§11、§17.2），由 XEP0060 的解析器写入 */
        pubsub?: PubsubErrorConditionInfo;
    }
}
