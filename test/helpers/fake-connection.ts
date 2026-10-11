import { EventEmitter } from "node:events";
import { JID } from "../../lib/JID";
import { Parser } from "../../lib/ltx/Parser";
import { XMPPElement } from "../../lib/ltx/Element";
import { SyncPipeline } from "../../lib/transport/pipeline";
import { Status } from "../../lib/transport/typing";

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
  readonly XEP0030 = {
    addFeature: (ns: string) => void this.features.add(ns),
    getServerFeatures: () => Promise.resolve(this.serverFeatures),
    identities: [] as Array<{ category: string; type: string }>,
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

  /** xep0156 等插件读取的连接字段 */
  url?: string;
  protocol: string | undefined = "ws";
  host?: string;
  port?: number;
  path?: string;
  tls = true;
  transport: object | null = {};

  /** 与 Connection.isSessionActive 对齐：由 transport.status 推导，测试改 transport 即可切换会话状态 */
  get isSessionActive(): boolean {
    return (
      (this.transport as { status?: number } | null)?.status ===
      Status.BINDED
    );
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
