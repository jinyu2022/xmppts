import { EventEmitter } from "node:events";
import { JID } from "../../lib/JID";
import { Parser } from "../../lib/ltx/Parser";
import { XMPPElement } from "../../lib/ltx/Element";
import { SyncPipeline } from "../../lib/transport/pipeline";
import type { DataForm } from "../../lib/plugins/xep0004/form";

/**
 * 记录插件注册调用的假连接，供插件 index 入口单元测试使用（不建立 socket）。
 * 提供插件 init() 最常用的注册/发送 API 与 XEP0030 假实现。
 * 默认 JID 沿用 XEP 示例中的 capulet 系命名。
 */
export class FakeConnection extends EventEmitter {
  readonly jid = new JID("juliet@capulet.lit/balcony");
  /** 插件发出的 stanza */
  readonly sent: XMPPElement[] = [];
  /** 已注册的 stanza 转换器：NS → handler */
  readonly stanzaPlugins = new Map<
    string,
    (stanza: XMPPElement) => Record<string, unknown>
  >();
  /** 已注册的事件插件 */
  readonly eventPlugins: Array<{
    eventName: string;
    tagName: string;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    matcher: (stanza: any) => boolean;
  }> = [];
  /** XEP0030 假实现：客户端宣告的特性、服务器特性与身份 */
  readonly features = new Set<string>();
  readonly serverFeatures = new Set<string>();
  /** disco#items 假数据，键为查询的 JID */
  readonly discoItems = new Map<
    string,
    Array<{ jid: string; name?: string; node?: string }>
  >();
  /** disco#info 假数据，键为查询的 JID；未配置时查询失败 */
  readonly discoInfo = new Map<
    string,
    {
      identities: Array<{
        category: string;
        type: string;
        name?: string;
        lang?: string;
      }>;
      features: Set<string>;
      extensions?: DataForm;
    }
  >();
  /** 已查询过 disco#info 的实体，按调用顺序记录 */
  readonly discoInfoCalls: string[] = [];
  readonly XEP0030 = {
    addFeature: (ns: string) => void this.features.add(ns),
    addIdentity: (category: string, type: string, name?: string, lang?: string) => {
      // 与 XEP0030.addIdentity 一致：category+type+xml:lang 唯一，重复时抛错
      if (
        this.XEP0030.identities.some(
          (i) => i.category === category && i.type === type && i.lang === lang,
        )
      ) {
        const key = lang ? `${category}/${type}/${lang}` : `${category}/${type}`;
        throw new Error(`已经存在相同身份标识: ${key}`);
      }
      this.XEP0030.identities.push({ category, type, name, lang });
    },
    getServerFeatures: () => Promise.resolve(this.serverFeatures),
    getDiscoItems: (to: string | JID) =>
      Promise.resolve(this.discoItems.get(to.toString()) ?? []),
    getDiscoInfo: (to: string | JID) => {
      this.discoInfoCalls.push(to.toString());
      const info = this.discoInfo.get(to.toString());
      return info
        ? Promise.resolve(info)
        : Promise.reject(new Error(`未配置 ${to.toString()} 的 disco#info`));
    },
    identities: [] as Array<{
      category: string;
      type: string;
      name?: string;
      lang?: string;
    }>,
    features: this.features,
  };
  /** 发送拦截链 */
  readonly pipeline = new SyncPipeline<{ send: { stanza: XMPPElement } }>();
  /** sendAsync 的固定结果，用例可替换 */
  sendAsyncResult: XMPPElement = Parser.parse(`<iq type="result"/>`);
  /** sendAsync 收到的 stanza，按调用顺序记录 */
  readonly sentAsync: XMPPElement[] = [];
  sendAsync = (stanza: XMPPElement): Promise<XMPPElement> => {
    this.sentAsync.push(stanza);
    return Promise.resolve(this.sendAsyncResult);
  };

  /** 插件读取的连接字段 */
  protocol: string | undefined = "ws";
  host?: string;
  port?: number;
  path?: string;
  tls = true;
  transport: object | null = {};

  /**
   * 会话是否活跃，对应真实连接的 Connection.isSessionActive。
   * 真实值由生命周期事件驱动（绑定成功置 true，派发 session:end 前置 false），与
   * transport.status 并不同步：需要表达「会话已结束但传输尚未关闭」时直接置 false。
   */
  sessionActive = false;

  get isSessionActive(): boolean {
    return this.sessionActive;
  }

  send(stanza: string | XMPPElement): void {
    this.sent.push(typeof stanza === "string" ? Parser.parse(stanza) : stanza);
  }

  registerStanzaPlugin(
    ns: string,
    handler: (stanza: XMPPElement) => Record<string, unknown>,
  ): void {
    this.stanzaPlugins.set(ns, handler);
  }

  registerEventPlugin(
    eventName: string,
    option: {
      tagName: string;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      matcher: (stanza: any) => boolean;
    },
  ): void {
    this.eventPlugins.push({ eventName, ...option });
  }

  /** 取指定事件名已注册的 matcher */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  matchersOf(eventName: string): Array<(stanza: any) => boolean> {
    return this.eventPlugins
      .filter((entry) => entry.eventName === eventName)
      .map((entry) => entry.matcher);
  }
}
