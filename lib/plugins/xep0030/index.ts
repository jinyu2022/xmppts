import type { Plugin } from "../types";
import type { Connection } from "@/connection";
import { Iq } from "@/stanza";
import { Disco } from "./disco";
import type { JID } from "../../JID";
import type { Identity, Item } from "./disco";
import type { DataForm } from "../xep0004/form";
import logger from "@/log";
import { XMPPError } from "@/errors";

const log = logger.getLogger("XEP0030");

interface DiscoInfoCache {
  identities: Identity[];
  features: Set<string>;
  extensions?: DataForm;
  timestamp: number;
}

interface DiscoItemCache {
  items: Item[];
  timestamp: number;
}

/**
 * XEP-0030: Service Discovery
 * @see https://xmpp.org/extensions/xep-0030.html
 * @version 2.5.0 (2024-04-30)
 */
export class XEP0030 implements Plugin {
  /** 自身身份列表，供响应他人的 disco#info 查询 */
  readonly identities: Identity[] = [];
  /** 自身特性集合，供响应他人的 disco#info 查询 */
  readonly features: Set<string> = new Set();
  /** 自身 disco 子项（如 PEP 节点），供响应他人的 disco#items 查询 */
  readonly items: Item[] = [];

  /** 服务器 disco#info 特性快照；会话开始后填充，未就绪时为空集 */
  private readonly serverFeatures: Set<string> = new Set();
  /** 服务器 disco#info 身份快照；会话开始后填充，未就绪时为空数组 */
  private readonly serverIdentities: Array<Identity> = [];
  /** 服务器 disco 发现；仅活跃会话内发起，并发调用共用同一次查询，失败后清空以便重试 */
  private discovery?: Promise<void>;

  /** 默认30分钟 */
  private readonly TTL = 1_800_000 as const;

  /** 查询info缓存, 键为jid */
  private readonly infoCache: Map<string, DiscoInfoCache> = new Map();
  /** 查询items缓存, 键为jid */
  private readonly itemsCache: Map<string, DiscoItemCache> = new Map();

  readonly connection: Connection;
  constructor(connection: Connection) {
    this.connection = connection;
  }

  init() {
    this.addFeature(Disco.NS.DISCO_INFO);
    this.addFeature(Disco.NS.DISCO_ITEMS);

    // 会话建立后才能查询；结果填充到快照字段，调用方等待 discover() 即可
    this.connection.once("session:start", () => {
      void this.discover().catch(() => {
        // 失败已在 discover 内 log.warn，这里只吞掉无人 await 时的 rejection
      });
    });

    this.connection.on("iq", (iq) => {
      if (iq.type !== "get") return;
      // TODO: 不应该操作xml，应该操作对象
      const stanza = iq.xml;
      // 只处理 iq 直接子元素中命名空间为 disco 的 query，其余交给对应插件
      const query = Array.from(
        stanza.querySelectorAll(":scope > query")
      ).find(
        (q) =>
          q.namespaceURI === Disco.NS.DISCO_INFO ||
          q.namespaceURI === Disco.NS.DISCO_ITEMS
      );
      if (!query) return;

      const from = stanza.getAttribute("from")!;
      const id = stanza.getAttribute("id")!;
      const node = query.getAttribute("node");
      if (query.namespaceURI === Disco.NS.DISCO_INFO) {
        this.connection.send(
          Disco.createInfoResult(this.identities, this.features, from, id, node)
        );
      } else if (query.namespaceURI === Disco.NS.DISCO_ITEMS) {
        this.connection.send(Disco.createItemsResult(this.items, from, id, node));
      } else {
        log.debug("无关disco查询", query);
      }
    });
  }

  /**
   * 服务器特性（disco#info）；首次发现未完成时等待，已完成则立即返回快照
   * @throws 会话未就绪或服务器查询失败
   */
  async getServerFeatures(): Promise<Set<string>> {
    // 会话门控在缓存复用之前：不活跃时连已缓存的查询结果也不返回
    if (!this.connection.isSessionActive) {
      throw new Error("会话尚未就绪");
    }
    await this.discover();
    // 返回一个新的 Set，避免外部修改快照
    return new Set(this.serverFeatures);
  }

  /**
   * 服务器身份（disco#info）；首次发现未完成时等待，已完成则立即返回快照
   * @throws 会话未就绪或服务器查询失败
   */
  async getServerIdentities(): Promise<Array<Identity>> {
    // 会话门控在缓存复用之前：不活跃时连已缓存的查询结果也不返回
    if (!this.connection.isSessionActive) {
      throw new Error("会话尚未就绪");
    }
    // 返回一个新的数组，避免外部修改快照
    await this.discover();
    return [...this.serverIdentities];
  }

  /** 发现服务器身份与特性，填充快照；并发调用复用同一次查询，失败后下次调用重试 */
  private discover(): Promise<void> {
    this.discovery ??= this.queryServerDisco().catch((error: unknown) => {
      this.discovery = undefined;
      log.warn("服务器身份特性获取失败", error);
      throw error;
    });
    return this.discovery;
  }

  /** 查询自己的服务器并刷新快照；复用 getDiscoInfo 的错误判断，刷新时跳过缓存读取 */
  private async queryServerDisco(): Promise<void> {
    const query = await this.getDiscoInfo(
      this.connection.jid.domain,
      undefined,
      false
    );
    this.serverFeatures.clear();
    this.serverIdentities.length = 0;
    for (const feature of query.features) {
      this.serverFeatures.add(feature);
    }
    this.serverIdentities.push(...query.identities);
    log.info("服务器身份特性获取成功");
  }

  /**
   * 发起一个disco#info查询
   * @param to 查询的对象
   * @param node 查询的节点
   * @param cache 是否使用缓存, 默认使用
   */
  async getDiscoInfo(to: string | JID, node?: string, cache = true) {
    const iq = Iq.createIq("get", to, Disco.NS.DISCO_INFO);
    if (node) {
      const query = iq.getElementsByTagName("query")[0];
      query.setAttribute("node", node);
    }
    if (cache) {
      const cached = this.infoCache.get(
        node ? `${to.toString()}#${node}` : to.toString()
      );
      if (cached && Date.now() - cached.timestamp < this.TTL) {
        return {
          identities: [...cached.identities],
          features: new Set(cached.features),
          extensions: cached.extensions,
        };
      }
    }
    const response = await this.connection.sendAsync(iq);
    if (response.getAttribute("type") === "error") {
      throw new XMPPError(response, "disco#info查询失败");
    }
    const discoInfo = Disco.parseDiscoInfo(response);
    this.updateCache(to, "info", discoInfo, node);
    return discoInfo;
  }

  /**
   * 发起一个disco#items查询
   * @param to 查询的对象
   * @param node 查询的节点
   * @param cache 是否使用缓存, 默认使用
   * @returns 子项列表
   */
  async getDiscoItems(to: string | JID, node?: string, cache = true): Promise<Item[]> {
    const iq = Iq.createIq("get", to, Disco.NS.DISCO_ITEMS);
    if (node) {
      const query = iq.getElementsByTagName("query")[0];
      query.setAttribute("node", node);
    }
    if (cache) {
      const cached = this.itemsCache.get(
        node ? `${to.toString()}#${node}` : to.toString()
      );
      if (cached && Date.now() - cached.timestamp < this.TTL) {
        return [...cached.items];
      }
    }
    const response = await this.connection.sendAsync(iq);
    if (response.getAttribute("type") === "error") {
      throw new XMPPError(response, "disco#items查询失败");
    }
    const items = Disco.parseDiscoItems(response);
    this.updateCache(to, "item", { items }, node);
    return items;
  }

  /**
   * 写入 disco 查询缓存，超出容量时淘汰最旧条目
   * @param to 查询的对象
   * @param type 查询的类型
   * @param cache 缓存内容
   * @param node 查询的节点，与 to 共同构成缓存键
   */
  private updateCache<T extends "info" | "item">(
    to: string | JID,
    type: T,
    cache: T extends "info"
      ? Omit<DiscoInfoCache, "timestamp">
      : Omit<DiscoItemCache, "timestamp">,
    node?: string | null
  ) {
    const key = node ? `${to.toString()}#${node}` : to.toString();
    if (type === "info") {
      this.infoCache.set(key, {
        ...cache as Omit<DiscoInfoCache, "timestamp">,
        timestamp: Date.now(),
      });
      // 限制大小为100个, 超过删除最早的
      if (this.infoCache.size > 100) {
        const sortedEntries = Array.from(this.infoCache.entries()).sort(
          ([, a], [, b]) => a.timestamp - b.timestamp
        );
        const deleteCount = Math.ceil(this.infoCache.size * 0.2);
        sortedEntries.slice(0, deleteCount).forEach(([k]) => {
          this.infoCache.delete(k);
        });
      }
    } else {
      this.itemsCache.set(key, {
        ...cache as Omit<DiscoItemCache, "timestamp">,
        timestamp: Date.now(),
      });
      // 限制大小为100个, 超过删除最早的
      if (this.itemsCache.size > 100) {
        const sortedEntries = Array.from(this.itemsCache.entries()).sort(
          ([, a], [, b]) => a.timestamp - b.timestamp
        );
        const deleteCount = Math.ceil(this.itemsCache.size * 0.2);
        sortedEntries.slice(0, deleteCount).forEach(([k]) => {
          this.itemsCache.delete(k);
        });
      }
    }
  }

  /**
   * 添加一个特性
   * @param value <feature/>元素的var属性值
   */
  addFeature(value: string) {
    this.features.add(value);
  }

  /**
   * 移除一个特性
   * @param value <feature/>元素的var属性值
   * @returns 是否成功移除
   */
  removeFeature(value: string) {
    return this.features.delete(value);
  }

  /**
   * 添加一个身份标识
   * @param category 身份类别
   * @param type 身份类型
   * @param name 身份的显示名称（可选）
   * @param lang 名称使用的语言二字代码（可选）
   */
  addIdentity(category: string, type: string, name?: string, lang?: string) {
    // category+type+xml:lang 唯一，name 不参与判定（XEP-0030 §3.1）
    if (
      this.identities.some(
        (i) =>
          i.category === category && i.type === type && i.lang === lang
      )
    ) {
      const key = lang ? `${category}/${type}/${lang}` : `${category}/${type}`;
      throw new Error(`已经存在相同身份标识: ${key}`);
    }
    this.identities.push({ category, type, name, lang });
  }

  /**
   * 移除一个身份标识
   * @param category 身份类别
   * @param type 身份类型
   * @param lang 名称使用的语言二字代码（可选）
   */
  removeIdentity(category: string, type: string, lang?: string) {
    const index = this.identities.findIndex(
      (i) => i.category === category && i.type === type && i.lang === lang
    );
    if (index !== -1) {
      this.identities.splice(index, 1);
    }
  }

  /**
   * 添加一个项目
   * @param jid 项目的JID
   * @param node 项目的节点
   * @param name 项目的显示名称
   */
  addItem(jid: string, node?: string, name?: string) {
    if (
      this.items.some(
        (i) => i.jid === jid && i.name === name && i.node === node
      )
    ) {
      const key = [jid, node, name].filter(Boolean).join("/");
      throw new Error(`已经存在相同的项目: ${key}`);
    }
    this.items.push({ jid, name, node });
  }

  /**
   * 移除一个项目
   * @param jid 项目的JID
   * @param name 项目的显示名称
   */
  removeItem(jid: string, name: string) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].jid === jid && this.items[i].name === name) {
        this.items.splice(i, 1);
      }
    }
  }
}
export default XEP0030;
