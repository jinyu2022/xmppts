import { XMPPElement } from "@/ltx/Element";
import { XEP0128 } from "@/plugins/xep0128";
import { Iq } from "@/stanza";
import type { JID } from "@/JID";
export interface Identity {
  category: string;
  type: string;
  name?: string;
  lang?: string;
}
export interface Item {
  jid: string;
  node?: string | null;
  name?: string | null;
}

/**
 * Service Discovery (XEP-0030) 纯工具类：命名空间常量与 disco 报文解析。
 * @see https://xmpp.org/extensions/xep-0030.html
 * @version 2.5.0 (2024-04-30)
 */
export class Disco {
  static readonly NS = {
    DISCO_INFO: "http://jabber.org/protocol/disco#info",
    DISCO_ITEMS: "http://jabber.org/protocol/disco#items",
  } as const;

  static parseDiscoInfo(xml: XMPPElement) {
    let query: XMPPElement | undefined;
    if (xml.namespaceURI !== Disco.NS.DISCO_INFO) {
      query = xml.getElementsByTagNameNS(Disco.NS.DISCO_INFO, "query")[0];
    } else {
      query = xml;
    }
    if (!query) {
      throw new Error(`disco#info 响应缺少 query 元素: ${xml.toXMLString()}`);
    }
    const identities = Array.from(query.getElementsByTagName("identity")).map(
      (identity) => {
        return {
          category: identity.getAttribute("category")!,
          type: identity.getAttribute("type")!,
          name: identity.getAttribute("name") ?? void 0,
          lang: identity.getAttribute("xml:lang") ?? void 0,
        };
      }
    );
    const features = new Set(
      Array.from(query.getElementsByTagName("feature")).map(
        (feature) => feature.getAttribute("var")!
      )
    );
    const {form} = XEP0128.parseDataForm(query);
    return { identities, features, extensions: form };
  }

  static parseDiscoItems(xml: XMPPElement) {
    let query: XMPPElement | undefined;
    if (xml.namespaceURI !== Disco.NS.DISCO_ITEMS) {
      query = xml.getElementsByTagNameNS(Disco.NS.DISCO_ITEMS, "query")[0];
    } else {
      query = xml;
    }
    if (!query) {
      throw new Error(`disco#items 响应缺少 query 元素: ${xml.toXMLString()}`);
    }
    const items = Array.from(query.getElementsByTagName("item")).map((item) => {
      return {
        jid: item.getAttribute("jid")!,
        node: item.getAttribute("node") ?? void 0,
        name: item.getAttribute("name") ?? void 0,
      };
    });
    return items;
  }

  /**
   * 用给定身份与特性构造 disco#info 应答
   * @param identities 身份列表
   * @param features 特性集合
   * @param to 应答对象
   * @param id 对应请求的 id
   * @param queryNode 请求的节点
   */
  static createInfoResult(
    identities: Identity[],
    features: Iterable<string>,
    to: string | JID,
    id: string,
    queryNode?: string | null
  ) {
    const iq = Iq.createIq("result", to);
    iq.setAttribute("id", id);
    const query = XMPPElement.createElementNS(Disco.NS.DISCO_INFO, "query");
    if (queryNode) {
      query.setAttribute("node", queryNode);
      // TODO: 到底要根据node返回什么？
    }
    iq.appendChild(query);
    for (const identity of identities) {
      query.appendChild(
        XMPPElement.createElement("identity", {
          category: identity.category,
          type: identity.type,
          ...(identity.name ? { name: identity.name } : {}),
          ...(identity.lang ? { "xml:lang": identity.lang } : {}),
        })
      );
    }
    for (const feature of features) {
      query.appendChild(XMPPElement.createElement("feature", { var: feature }));
    }
    return iq;
  }

  /**
   * 用给定子项构造 disco#items 应答
   * @param items 子项列表
   * @param to 应答对象
   * @param id 对应请求的 id
   * @param queryNode 请求的节点，同一节点下的子项才返回
   */
  static createItemsResult(
    items: Item[],
    to: string | JID,
    id: string,
    queryNode?: string | null
  ) {
    const iq = Iq.createIq("result", to);
    iq.setAttribute("id", id);
    const query = XMPPElement.createElementNS(Disco.NS.DISCO_ITEMS, "query");
    if (queryNode) {
      query.setAttribute("node", queryNode);
    }
    iq.appendChild(query);
    const matched = queryNode
      ? items.filter((i) => i.node === queryNode)
      : items;
    for (const item of matched) {
      query.appendChild(
        XMPPElement.createElement("item", {
          jid: item.jid,
          ...(item.name ? { name: item.name } : {}),
          ...(item.node ? { node: item.node } : {}),
        })
      );
    }
    return iq;
  }
}