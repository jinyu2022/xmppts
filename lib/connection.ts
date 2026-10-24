import { Emitter } from "./emitter";
import { XMPPElement } from "./ltx/Element.js";
import { Parser } from "./ltx/Parser";
import { JID } from "./JID";
import logger from "./log";
import { pluginLoaders } from "./plugins/index";
import type {
  Plugin,
  PluginFactory,
  PluginOptions,
  PluginOptionsOf,
} from "./plugins/types";
import { Message, Iq, Presence, StanzaBase } from "./stanza";
import { Status, type TransportSink, type TransportSocket } from "./transport/typing";
import { SyncPipeline } from "./transport/pipeline";
import { defaultTransports, type TransportFactory } from "./transport/index";
import { ProtocolError } from "./errors";
import type { Protocol, Options } from "./types";
const log = logger.getLogger("connection");

/** stanza 标签 → 实例类型 */
interface StanzaTypeMap {
  message: Message;
  iq: Iq;
  presence: Presence;
  others: StanzaBase;
}

/** 插件名 → 插件实例类型，用于把插件实例合并到 {@link Connection} */
type PluginRegistry = {
  [K in keyof typeof pluginLoaders]?: InstanceType<
    Awaited<ReturnType<(typeof pluginLoaders)[K]>>
  >;
};

/**
 * 判断元素是否为三大节，并把类型收窄为 {@link StanzaTypeMap} 的键。
 * 其余元素属流层（如 `<stream:error>`、SASL 元素）。
 */
function isStanzaTag(tagName: string): tagName is keyof StanzaTypeMap {
  return tagName === "message" || tagName === "iq" || tagName === "presence";
}

// 定义所有可能的事件参数类型
export interface SocketEventMap {
  message: Message;
  iq: Iq;
  presence: Presence;
  others: StanzaBase;
  /** 每次 connect() 后的首次绑定成功 */
  "session:start": void;
  /**
   * 会话正式结束：连接关闭且不再重连（主动断开、对端关闭、协商失败或重连耗尽）；
   * 自动重连期间不发。派发前 `isSessionActive` 已降为 `false`，监听器内不能继续发送业务 stanza。
   */
  "session:end": void;
  /** 连接错误（网络失败、认证失败、协议错误等）；会话可能尚未建立 */
  error: Error;
  /** 进入自动重连：已建立会话的物理连接断开且仍会重试；同一次断线只发一次 */
  "connection:lost": void;
  /** 正在自动重连，每次尝试前发出 */
  reconnecting: void;
  /** 自动重连成功（会话此前已建立，不再发 session:start） */
  reconnected: void;
}

/**
 * 指定标签可注册的事件名：载荷类型是该标签 stanza 类型子类型的事件。
 *
 * 插件事件（`Message & { ... }` 这类扩展量）因此能注册到对应标签；
 * 生命周期事件（载荷 void）与自定义载荷事件（如 muc:stale）不兼容，被排除。
 */
type EventNameFor<T extends keyof StanzaTypeMap> = {
  [E in keyof SocketEventMap]-?: NonNullable<
    SocketEventMap[E]
  > extends StanzaTypeMap[T]
    ? E
    : never;
}[keyof SocketEventMap];

/**
 * 事件插件注册项：三个字段互相约束。
 *
 * `tagName` 决定 `matcher` 收到的 stanza 类型与可选的事件名范围，
 * `eventName` 的载荷须兼容该标签的 stanza 类型。
 */
interface EventPluginMap<T extends keyof StanzaTypeMap> {
  /** 标签名，决定 matcher 参数类型与事件名范围 */
  tagName: T;
  /** 事件名，载荷须是 {@link StanzaTypeMap}[T] 的子类型 */
  eventName: EventNameFor<T>;
  /** 匹配器，返回 true 则派发 eventName */
  matcher: (stanza: StanzaTypeMap[T]) => boolean;
}

/** 事件插件表元素：注册时的约束由 EventPluginMap 保证，表内统一存储 */
interface EventPluginEntry {
  /** 事件名 */
  eventName: EventNameFor<keyof StanzaTypeMap>;
  /**
   * 匹配器。声明为方法签名，参数因此可双变：注册时可存入参数更窄的匹配器
   * （如 `(stanza: Message) => boolean`）；派发时按运行时标签只会传入对应实例。
   */
  matcher(stanza: StanzaTypeMap[keyof StanzaTypeMap]): boolean;
}

// 插件实例以属性形式合并到连接实例上
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface Connection extends PluginRegistry {}
// 声明合并
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Connection extends Emitter<SocketEventMap> {
  jid: JID;
  password: string;
  /** 连接协议，按此值从 `transports` 注册表选择传输实现 */
  protocol: Protocol = "xmpp";
  /** 连接主机；未指定时由传输自行发现（TCP 查 SRV） */
  host?: string;
  /** 连接的端口；未指定时用传输默认端口 */
  port?: number;
  /** 连接的路径（WebSocket/BOSH） */
  path?: string;
  /** 是否启用tls，在本地调试的时候您可能不需要，默认为true */
  tls = true;

  /** 是否自动重连 */
  private autoReconnect = false;
  /** 重连间隔 */
  private reconnectInterval = 1000;
  /** 最大重连间隔，默认30000ms */
  private reconnectMaxInterval = 30000;
  /** 最大连续重连次数 */
  private reconnectMaxAttempts = 3;
  /** 当前连续失败的重连次数，绑定成功后清零 */
  private reconnectAttempts = 0;
  /** 重连定时器 */
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  /**
   * 当前的连接实例
   * @warrning 你要知道你自己在做什么
   */
  transport: TransportSocket | null = null;

  /**
   * 协议到传输工厂的映射。
   * 默认包含内置的 xmpp/ws/http，可通过 {@link registerTransport} 追加或覆盖。
   */
  readonly transports: Record<string, TransportFactory> = {
    ...defaultTransports,
  };

  /**
   * 会话状态三态：
   * - `undefined`：本次连接从未绑定成功（首连中、首连失败或已终结）
   * - `true`：会话可用（资源绑定成功至流关闭/断线之间）
   * - `false`：曾绑定成功、当前不可用（自动重连中，或 session:end 派发期间）
   */
  private sessionActive?: boolean;

  /** {@link sessionActive} 的只读视图，供插件判断是否需要继续后台任务 */
  get isSessionActive(): boolean {
    return this.sessionActive === true;
  }

  /** 插件列表，键是插件名 */
  private readonly pendingPlugins = new Map<
    string,
    {
      func?: PluginFactory;
      loader?: () => Promise<PluginFactory>;
      options?: unknown;
    }
  >();

  /** stanza处理插件，键是NS，值是函数 */
  private readonly stanzaPlugins = new Map<
    string,
    (stanza: XMPPElement) => Record<string, unknown>
  >();

  private readonly eventPlugins: Record<keyof StanzaTypeMap, EventPluginEntry[]> =
    {
      message: [],
      iq: [],
      presence: [],
      others: [],
    };

  /** 发送/接收管线：stanza 在共享数据上就地传递，处理器不调 next 即短路；插件直接 use 注册 */
  readonly pipeline = new SyncPipeline<{
    send: { stanza: XMPPElement };
    receive: { stanza: XMPPElement };
  }>();

  /** 等待响应的请求，键为 stanza id */
  private readonly pendingRequests = new Map<
    string,
    {
      /** 兑现响应；调用即结束等待（停计时器、删表项） */
      resolve: (stanza: XMPPElement) => void;
      /** 以错误结束等待；断开时批量调用 */
      reject: (error: Error) => void;
    }
  >();

  /**
   * 创建一个连接
   * @param jid 完整的账号，例如：user@domain.com
   * @param password 密码
   * @param options 自定义配置，一般不需要配置，包括：
   *    - host 为连接主机，未指定时由传输发现
   *    - protocol 为连接协议，内置 xmpp/ws/http，自定义协议可用 registerTransport 注册
   *    - tls 为是否启用tls，在本地调试的时候您可能不需要，默认为true
   */
  constructor(jid: string, password: string, options?: Options) {
    super();
    this.jid = new JID(jid);
    this.password = password;

    this.protocol = options?.protocol ?? this.protocol;
    this.host = options?.host ?? this.host;
    if (!this.host) log.debug("未指定service，将尝试从域名获取");
    this.port = options?.port ?? this.port;
    if (!this.port) log.debug("未指定port，将使用默认端口");
    this.path = options?.path ?? this.path;
    this.tls = options?.tls ?? this.tls;
    this.autoReconnect = options?.reconnect ?? this.autoReconnect;
    this.reconnectInterval = options?.reconnectInterval ?? this.reconnectInterval;
    this.reconnectMaxInterval =
      options?.reconnectMaxInterval ?? this.reconnectMaxInterval;
    this.reconnectMaxAttempts =
      options?.reconnectMaxAttempts ?? this.reconnectMaxAttempts;

    // 写出是发送管线的终端：拦截器在 next() 返回后即可确认 stanza 已交给传输层
    this.pipeline.terminal("send", this.write);
  }

  /**
   * 发送管线终端：写出最终 stanza；未连接即抛错。
   *
   * 必须是终端而不是普通中间件：拦截器与流恢复依赖 `next()` 返回后即可确认
   * stanza 已写出；终端不被 `pipeline.clear()` 清除，无需随插件重建。
   */
  private readonly write = (ctx: { stanza: XMPPElement }) => {
    if (!this.transport) {
      throw new Error("连接已断开");
    }
    this.transport.send(ctx.stanza);
  };

  /**
   * 注册自定义插件
   * @param name 插件名称
   * @param func 插件构造函数
   * @param options 传给插件构造函数的配置，省略时插件使用自身默认值
   */
  registerPlugin<C extends PluginFactory>(
    name: string,
    func: C,
    options?: PluginOptionsOf<C>,
  ): void;
  /**
   * 注册内置插件
   * @param name 内置插件名称
   * @param options 传给插件构造函数的配置，省略时插件使用自身默认值
   */
  registerPlugin<K extends keyof typeof pluginLoaders>(
    name: K,
    options?: PluginOptions<K>,
  ): void;

  registerPlugin(
    name: string,
    funcOrOptions?: PluginFactory | object,
    options?: unknown,
  ): void {
    // 第二参数可能是自定义构造函数，也可能是内置插件的配置
    if (typeof funcOrOptions === "function") {
      this.pendingPlugins.set(name, {
        func: funcOrOptions as PluginFactory,
        options,
      });
      return;
    }
    const loader = pluginLoaders[name as keyof typeof pluginLoaders];
    if (!loader) throw new Error(`未找到插件 ${name}`);
    this.pendingPlugins.set(name, { loader, options: funcOrOptions });
  }

  /**
   * 递归注册插件自身及其全部依赖，依赖只会是内置插件
   * @param name 要注册的插件名
   * @param visited 已处理的插件名，避免重复遍历与依赖环
   * @param parent 依赖方插件名，仅用于错误提示
   * @throws 插件或其依赖不在内置插件表中
   */
  private async checkAndRegisterDep(
    name: string,
    visited = new Set<string>(),
    parent?: string,
  ): Promise<void> {
    if (visited.has(name)) return;
    visited.add(name);
    const reg = this.pendingPlugins.get(name);
    const loader =
      reg?.loader ?? pluginLoaders[name as keyof typeof pluginLoaders];
    // 已注册的自定义插件没有 loader，但它缓存的构造函数同样可用
    let func: PluginFactory | undefined = reg?.func;
    if (!func) {
      if (!loader) {
        throw new Error(
          parent ? `${parent} 依赖的插件 ${name} 不存在` : `未找到插件 ${name}`,
        );
      }
      func = await loader();
      // 更新 pendingPlugins
      this.pendingPlugins.set(name, { ...reg, loader, func });
    }
    const deps = func.dependencies ?? [];
    for (const dep of deps) {
      if (!this.pendingPlugins.has(dep)) {
        log.warn(`${name} 需要 ${dep} 插件，现在自动注册`);
      }
    }
    // 同层依赖并行递归；下一层须等本层构造函数 resolve 后才能展开
    await Promise.all(
      deps.map((dep) => this.checkAndRegisterDep(dep, visited, name)),
    );
  }

  /** 调用插件 init()：此时 transport 已创建，可注册管线与事件处理器 */
  private initPlugins() {
    for (const name of this.pendingPlugins.keys()) {
      // pendingPlugins 的键即插件属性名，实例已在 instantiatePlugins 中挂到 this 上
      this[name as keyof PluginRegistry]?.init();
    }
  }

  /**
   * 注册stanza处理插件
   *
   * handler 负责解析自己命名空间下的内容：把本 NS 的元素解析到不能再解析为止，
   * 返回纯数据；属于其他命名空间的子元素原样放进返回值，由框架递归交给对应的
   * handler（如 carbons → forwarded → delay 的链式解析）。返回值里若保留了本 NS
   * 的元素，它会被再次交给同一个 handler。
   * @param NS 命名空间
   * @param handler 处理函数，返回合并到 stanza 实例上的字段
   */
  registerStanzaPlugin(
    NS: string,
    handler: (stanza: XMPPElement) => Record<string, unknown>,
  ) {
    this.stanzaPlugins.set(NS, handler);
  }

  /**
   * 注册事件插件
   *
   * 事件载荷必须与标签对应的 stanza 类型兼容（`Message & { ... }` 这类扩展也算），
   * 因此生命周期事件、自定义载荷事件无法注册到 stanza 标签上。
   * @param eventName 事件名称
   * @param option 选项
   * @param option.tagName 标签名，决定 matcher 参数与可注册的事件范围
   * @param option.matcher 匹配器，返回true则触发事件
   */
  registerEventPlugin<T extends keyof StanzaTypeMap>(
    eventName: EventNameFor<T>,
    option: Omit<EventPluginMap<T>, "eventName">,
  ) {
    const { tagName, matcher } = option;
    // 表内按所有标签宽化存储：T 是联合的子集，EventNameFor<T> 必然包含于
    // EventNameFor<keyof StanzaTypeMap>，属安全的向上转型
    this.eventPlugins[tagName].push({
      eventName: eventName as EventNameFor<keyof StanzaTypeMap>,
      matcher,
    });
  }

  async connect() {
    // 已在连接或已连接：拒绝重复调用，避免新旧两个 socket 并存
    if (this.transport && this.transport.status !== Status.DISCONNECTED) {
      throw new Error("连接已在进行中，请先 disconnect() 再连接");
    }
    // 手动连接：取消等待中的自动重连，避免其定时器与本次连接竞争
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    // 复位重连计数，本次连接从零开始
    this.reconnectAttempts = 0;
    // 新连接从「未绑定」开始：首次绑定发 session:start 而非 reconnected
    this.sessionActive = undefined;
    // 清掉上一次插件注册的中间件，避免重复调用时叠加（终端由管线自身保留）
    this.pipeline.clear();
    // 插件实例化先于传输创建：构造函数可注册传输或补全连接配置
    await this.instantiatePlugins();
    const create = this.transports[this.protocol];
    if (!create) {
      throw new Error(`未知的协议: ${this.protocol}`);
    }
    let transport: TransportSocket;
    try {
      transport = await create({
        jid: this.jid,
        password: this.password,
        tls: this.tls,
        host: this.host,
        port: this.port,
        path: this.path,
        sink: this._createSink(),
      });
    } catch (error) {
      throw this.reportError(error);
    }
    this.transport = transport;
    this.initPlugins();
    try {
      await transport.connect();
    } catch (error) {
      throw this.reportError(error);
    }
  }

  /**
   * 把连接失败归一化为 Error 并以 error 事件公开。
   * 调用方仍会收到 reject，可根据自身需要选择监听事件或等待 Promise。
   */
  private reportError(error: unknown): Error {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.emit("error", failure);
    return failure;
  }

  /**
   * 实例化插件：依赖解析 → `new Plugin(connection)`。
   * 此时 transport 尚未创建，构造函数可注册传输或补全连接配置，
   * 但不得访问传输层管线（在 {@link initPlugins} 中完成）。
   */
  private async instantiatePlugins() {
    await Promise.all(
      Array.from(this.pendingPlugins.keys(), (name) =>
        this.checkAndRegisterDep(name),
      ),
    );
    // 先全部实例化，保证 init() 里能访问到依赖实例
    for (const [name, { func, options }] of this.pendingPlugins) {
      // options 的类型已在 registerPlugin 处按具体构造函数校验；
      // PluginFactory 的构造签名不关心第二参数，这里按运行期实际传参调用
      const create = func as unknown as new (
        connection: Connection,
        options?: unknown,
      ) => Plugin;
      Object.assign(this, { [name]: new create(this, options) });
    }
  }

  /**
   * 注册一种传输实现，供该连接实例使用。
   *
   * 同名协议覆盖已有实现。插件也会在构造函数中调用本方法（如 XEP0368 覆盖 `xmpp`），
   * 而插件实例化发生在 {@link connect} 内部、晚于用户调用本方法的时机，因此**同名协议的
   * 插件注册会覆盖用户注册**；要保留自定义实现，请勿注册会覆盖该协议的插件，或改用其他协议名。
   * @param protocol 协议名（URL scheme），与 {@link protocol} 取值对应
   * @param create 传输工厂，见 {@link TransportFactory}
   */
  registerTransport(protocol: string, create: TransportFactory): void {
    this.transports[protocol] = create;
  }

  /**
   * 创建传输层通知接收者，随传输实例一并传入工厂。
   *
   * 传输实例由本连接创建并一对一持有，通知同步按调用顺序处理；
   * 会话状态在派发对应公开事件前先行更新（监听器内读到的是新状态）。
   * @private 仅供内部使用（测试用它给假传输层注入 sink）
   */
  _createSink(): TransportSink {
    return {
      // XMPP 会话可用
      onBinded: () => {
        // RFC 6120 §4.3.6 / §7.7.1：以服务器返回的 bound JID 为准
        const boundJid = this.transport?.jid;
        if (boundJid && boundJid.full !== this.jid.full) this.jid = boundJid;
        // 绑定成功即视为连接可用，重置连续失败计数
        this.reconnectAttempts = 0;
        // 先置位再派发，保证监听器内读到新状态（可在回调里直接发 stanza）
        if (this.sessionActive === undefined) {
          this.sessionActive = true;
          this.emit("session:start");
        } else {
          this.sessionActive = true;
          this.emit("reconnected");
        }
      },
      // 协商完成后的业务 stanza
      onStanza: (stanza) => this.onMessage(stanza),
      // 传输层错误（连接/协商/认证失败、超时等），直接交给上层；断开收尾由 onClose 处理
      onError: (error: Error) => {
        log.error("连接错误:", error);
        this.emit("error", error);
        // 传输层用 retryable 标记可重试的临时错误（超时、system-shutdown 等），
        // 其余协议错误重试无意义，直接终结会话
        if (error instanceof ProtocolError && !error.retryable) {
          this.finishSession();
        }
      },
      // 套接字关闭：网络类断开自动重连（含 socket 已建立但首连未完成）；协商失败已在 onError 中终结
      onClose: () => {
        // 已终结（finishSession 置空 transport）或陈旧 close（新连接已开始）：不再处理
        if (!this.transport || this.transport.status !== Status.DISCONNECTED)
          return;
        log.info("连接已关闭");
        // 连续失败计数：绑定成功即清零，用尽后彻底退出
        const canReconnect =
          this.autoReconnect &&
          this.reconnectAttempts < this.reconnectMaxAttempts;
        // 套接字关闭：会话必然不可用（自动重连成功后会重新置位）
        if (this.sessionActive === true) {
          this.sessionActive = false;
          // 仅在已建立会话的首次断线时通知；后续重试失败会反复触发 onClose
          if (canReconnect) this.emit("connection:lost");
        }
        if (canReconnect) {
          this.scheduleReconnect();
          return;
        }
        this.finishSession();
      },
    };
  }

  /**
   * 断开连接，清除监听器与插件运行时状态
   * @experimental 你在 connection 上注册的事件监听会被清除，重新 connect() 前需自行重新 on()；
   * 插件不必重新 registerPlugin，connect() 会用保留的插件列表自动重建
   */
  disconnect() {
    // 清理待执行的重连，避免陈旧定时器抢先
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const transport = this.transport;
    // 未连接或已断开：无需等待事件，直接通知并清理
    if (!transport || transport.status === Status.DISCONNECTED) {
      this.finishSession();
      return;
    }
    // 先终结会话（transport 置空，后续 close 不再调度重连），再关闭流
    this.finishSession();
    transport.disconnect();
  }

  /**
   * 终结本次会话：先降级会话状态，再派发 session:end，最后清理。
   *
   * 错误由 onError 直接上报，本方法不再携带错误；
   * 会话从未建立时没有配对的 session:start，不发 session:end。
   * 先置 `false` 再派发：监听器内 `isSessionActive` 必须读到「会话已结束」，
   * `send()` 也会按会话不可用拒绝业务 stanza；`_cleanup()` 随后归为 `undefined`。
   */
  private finishSession() {
    // 从未绑定成功就没有配对的 session:start，不发 session:end
    if (this.sessionActive !== undefined) {
      this.sessionActive = false;
      this.emit("session:end");
    }
    this._cleanup();
  }

  /**
   * 清除监听器与插件运行时状态。
   * 刻意保留 pendingPlugins：真断开后复用本实例 connect() 时由 instantiatePlugins()/initPlugins() 重建插件，调用方无需重新 registerPlugin
   */
  private _cleanup() {
    // 清理待执行的重连定时器，避免残留
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempts = 0;
    // 终结：回到「从未绑定」，并释放传输引用（close 回调据此判断已终结）
    this.sessionActive = undefined;
    this.transport = null;
    // 断开后不会再收到响应，结束所有等待中的请求
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error("连接已断开"));
    }
    this.pendingRequests.clear();
    // 清除所有监听器（含应用层与插件注册的）
    this.removeAllListeners();
    // 清空插件注册的中间件（终端由管线自身保留），避免重建插件时重复注册
    this.pipeline.clear();
    for (const plugins of Object.values(this.eventPlugins)) {
      plugins.length = 0;
    }
    this.stanzaPlugins.clear();
  }

  /**
   * 按指数退避调度一次重连。复用传输层，
   * 保留同一 socket 实例（管线处理器与会话状态如 XEP-0198 的 previd 不丢失）。
   * 已有调度、未启用自动重连或超过最大次数时不重复调度。
   * 开启重连时应当实现无感重连，不能让上层会话意识到链接已经断开和重新连接
   */
  private scheduleReconnect() {
    // 存在定时器认为已经调度过了
    if (this.reconnectTimer || !this.autoReconnect) return;
    if (this.reconnectAttempts >= this.reconnectMaxAttempts) {
      log.warn("已达到最大重连次数，停止重连");
      // reconnect() 建立 socket 前就抛错时其 rollback 会移除 close 监听，close 不再触发，需在此补终结
      this.finishSession();
      return;
    }

    const delay = Math.min(
      this.reconnectInterval * 2 ** this.reconnectAttempts,
      this.reconnectMaxInterval,
    );
    this.reconnectAttempts++;
    log.info(`准备在 ${delay}ms 后重连`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      // 已被新连接替换或状态不允许（正在连接中）时放弃本次重连
      if (this.transport?.status !== Status.DISCONNECTED) return;
      this.emit("reconnecting");
      this.transport.reconnect().catch((error: unknown) => {
        log.error("重连失败:", error);
        this.scheduleReconnect();
      });
    }, delay);
    // 句柄须先落字段再 unref：浏览器 setTimeout 返回数字无 unref，链式调用会求值成 undefined
    this.reconnectTimer.unref?.();
  }

  private onMessage(stanza: XMPPElement) {
    log.debug("receive", () => stanza.toXMLString());

    // 拦截器（就地传递，处理器不调 next 即短路）
    stanza = this.pipeline.run("receive", { stanza }).stanza;

    const tagName = isStanzaTag(stanza.tagName) ? stanza.tagName : "others";
    // 先兑现等待中的请求；命中后仍继续派发，普通监听器仍能看到该节
    const requestId = stanza.getAttribute("id");
    if (requestId) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);
        pending.resolve(stanza);
      }
    }
    const stanzaInstance = this.stanzaInstanceFactory(stanza, tagName);
    // 发出节事件
    for (const eventPlugin of this.eventPlugins[tagName]) {
      if (eventPlugin.matcher(stanzaInstance)) {
        this.emit(eventPlugin.eventName, stanzaInstance);
      }
    }
    this.emit(tagName, stanzaInstance);
  }

  /**
   * 构造 stanza 实例，转换扩展元素并派发事件插件。
   *
   * 事件插件表按标签分组，注册时已保证每项的事件名与标签对应，
   * 故此处按运行时 `tagName` 取组即可。
   * @param stanza 原始元素
   * @param tagName 由 {@link isStanzaTag} 判定的标签分组
   */
  private stanzaInstanceFactory(
    stanza: XMPPElement,
    tagName: keyof StanzaTypeMap,
  ) {
    let stanzaInstance: StanzaTypeMap[keyof StanzaTypeMap];

    if (tagName === "message") {
      stanzaInstance = this.transformExtensions(new Message(stanza, this));
    } else if (tagName === "iq") {
      stanzaInstance = this.transformExtensions(new Iq(stanza, this));
    } else if (tagName === "presence") {
      stanzaInstance = this.transformExtensions(new Presence(stanza, this));
    } else {
      stanzaInstance = this.transformExtensions(new StanzaBase(stanza, this));
    }

    return stanzaInstance;
  }

  /**
   * 把 stanza 的直接子元素交给对应命名空间的转换器，结果合并到实例上；无转换器的子元素跳过。
   * 会直接修改原实例
   * @param instance stanza 实例
   * @returns 返回 instance
   */
  private transformExtensions(instance: StanzaBase) {
    /** 已访问对象，防止转换结果中的循环引用或 handler 返回输入元素本身导致无限递归 */
    const visited = new Set<unknown>();
    // 构造阶段产出的普通对象字段（如 error 的附加条件元素）也需转换
    for (const value of Object.values(instance)) {
      // 不需要访问数组、类实例、null、undefined、原型链上继承的对象；只访问普通对象
      if (value && Object.getPrototypeOf(value) === Object.prototype) {
        this.transformNested(value as Record<string, unknown>, visited);
      }
    }
    for (const child of instance.xml.children) {
      const handler = this.stanzaPlugins.get(child.namespaceURI ?? "");
      if (!handler) continue;
      visited.add(child);
      const transformed = handler(child);
      this.transformNested(transformed, visited);
      Object.assign(instance, transformed);
    }
    return instance;
  }

  /**
   * 递归转换 handler 返回值中嵌套的元素；无转换器的元素原样保留
   * @param obj handler 返回的普通对象
   * @param visited 已访问对象集合
   */
  private transformNested(obj: Record<string, unknown>, visited: Set<unknown>) {
    if (!obj || typeof obj !== "object" || visited.has(obj)) return;
    visited.add(obj);
    for (const key in obj) {
      const value = obj[key];
      if (value instanceof XMPPElement) {
        if (visited.has(value)) continue;
        const handler = this.stanzaPlugins.get(value.namespaceURI ?? "");
        if (!handler) continue;
        visited.add(value);
        const transformed = handler(value);
        this.transformNested(transformed, visited);
        delete obj[key];
        Object.assign(obj, transformed);
      } else if (value && Object.getPrototypeOf(value) === Object.prototype) {
        this.transformNested(value as Record<string, unknown>, visited);
      }
    }
  }

  /**
   * 发送一个元素
   * @param stanza 传入字符串时会先解析成元素
   *
   * message/iq/presence 走属性校验、id 注入与发送拦截器；
   * 其余元素属流层，不加工不校验，但仍走发送管线，插件可介入
   * @throws 未连接或已断开；业务 stanza 在会话未就绪时也抛出 Error
   */
  send(stanza: XMPPElement | string) {
    // 未连接或已断开时在入口拦下：链尾终端只负责写出，不判断会话可用性
    if (!this.transport || this.transport.status === Status.DISCONNECTED) {
      throw new Error("连接已断开");
    }
    if (typeof stanza === "string") {
      stanza = Parser.parse(stanza);
    }
    if (isStanzaTag(stanza.tagName)) {
      if (!this.isSessionActive) {
        throw new Error("会话尚未就绪");
      }
      // 一个拥有特定接收者的节必须拥有一个'to'属性；
      // 从客户端发往服务器、由服务器直接处理的节（如 presence）不能有 'to'
      if (stanza.tagName === "message" && !stanza.getAttribute("to")) {
        throw new Error(`message stanza缺少to属性：${stanza.toXMLString()}`);
      }
      // 如果节是groupchat，那么必须使用bare JID作为to属性
      if (
        stanza.tagName === "message" &&
        stanza.getAttribute("type") === "groupchat"
      ) {
        const to = stanza.getAttribute("to");
        if (to?.includes("/")) {
          log.warn(
            "groupchat类型的message stanza的to属性应该是bare JID，正在自动转换",
          );
          stanza.setAttribute("to", to.split("/")[0]);
        }
      }
      if (stanza.tagName === "iq" && !stanza.getAttribute("type")) {
        throw new Error(`iq stanza缺少type属性：${stanza.toXMLString()}`);
      }
      if (!stanza.getAttribute("id")) {
        stanza.setAttribute("id", crypto.randomUUID());
      }
      if (!stanza.namespaceURI) {
        stanza.setAttribute("xmlns", "jabber:client");
      }
    }
    /** 终端会再次检查传输是否仍在，防止拦截器执行期间被置空 {@link write} */
    this.pipeline.run("send", { stanza });
  }

  /**
   * 发送一个stanza，返回一个Promise对象
   * @param stanza 要发送的stanza
   * @param timeout 超时时间，默认30秒
   * @returns 同 id 的响应；会话未就绪、发送失败或超时均 reject
   * @throws 超时时抛出 name 为 "TimeoutError" 的 DOMException
   */
  sendAsync(stanza: XMPPElement, timeout = 30000) {
    // 未带 id 时补一个，响应按 id 匹配到本次等待
    if (!stanza.getAttribute("id")) {
      stanza.setAttribute("id", crypto.randomUUID());
    }
    const id = stanza.getAttribute("id")!;
    return new Promise<XMPPElement>((resolve, reject) => {
      /** 结束等待：停计时器、删表项，再 settle */
      const finish = (action: () => void) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        action();
      };
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(new DOMException("发送stanza超时", "TimeoutError")),
          ),
        timeout,
      );
      timer.unref?.();
      this.pendingRequests.set(id, {
        resolve: (response) => finish(() => resolve(response)),
        reject: (error) => finish(() => reject(error)),
      });
      try {
        this.send(stanza);
      } catch (err) {
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    });
  }
}

export default Connection;
