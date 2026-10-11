import { EventEmitter } from "node:events";
import { XMPPElement } from "./ltx/Element.js";
import { TimeoutError } from "./errors";
import { JID } from "./JID";
import logger from "./log";
import { Message, Iq, Presence, StanzaBase } from "./stanza";
import { Status, type TransportSocket } from "./transport/typing";
import { SyncPipeline } from "./transport/pipeline";
import type { Protocol, Options } from "./types";
const log = logger.getLogger("connection");

interface StanzaHandlerMap {
  message: (message: Message) => void;
  iq: (iq: Iq) => void;
  presence: (presence: Presence) => void;
  others: (other: StanzaBase) => void;
}

interface EventHandlerMap {
  message: (message: Message) => boolean;
  iq: (iq: Iq) => boolean;
  presence: (presence: Presence) => boolean;
  others: (other: StanzaBase) => boolean;
}
// 事件插件映射类型
interface EventPluginMap<K extends keyof EventHandlerMap> {
  eventName: keyof SocketEventMap;
  matcher: EventHandlerMap[K];
}

// 定义所有可能的事件参数类型
export interface SocketEventMap {
  message: Message;
  iq: Iq;
  presence: Presence;
  others: StanzaBase;
  /**代表连接建立 */
  connect: void;
  "session:start": void;
  /** 会话正式结束：本端发出流尾或收到对端流尾；自动重连期间不发 */
  "session:end": void;
  /** 物理连接断开；自动重连期间不发，进入断线态时只发一次 */
  "connection:lost": void;
  /** 正在自动重连，每次尝试前发出 */
  reconnecting: void;
  /** 自动重连成功（会话此前已建立，不再发 session:start） */
  reconnected: void;
  /** 套接字关闭；自动重连期间不发 */
  disconnect: void;
}
// 扩展 EventEmitter 类型定义
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Connection extends PluginRegistry {
  on<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => unknown,
  ): this;

  off<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => unknown,
  ): this;

  once<E extends keyof SocketEventMap>(
    event: E,
    listener: (arg: SocketEventMap[E]) => unknown,
  ): this;

  emit<E extends keyof SocketEventMap>(
    event: E,
    arg?: SocketEventMap[E],
  ): boolean;
}
// 声明合并
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Connection extends EventEmitter {
  jid: JID;
  password: string;
  /** 连接协议，xmpp仅node环境可用，ws暂时禁用 */
  protocol: Protocol = "xmpp";
  /** 连接的url，不要前缀 */
  host?: string;
  /** 连接的端口 */
  port?: number;
  /** 连接的路径 */
  path?: string;
  /** 连接的url */
  url?: string;
  /** 是否启用tls，在本地调试的时候您可能不需要，默认为true */
  tls = true;

  /** 是否自动重连 */
  private autoReconnect = false;
  /** 重连间隔 */
  private reconnectInterval = 1000;
  /** 最大重连间隔，默认30000ms */
  private reconnectMaxInterval = 30000;
  /** 最大重连次数 */
  private reconnectMaxAttempts = 3;
  /** 当前重连次数 */
  private reconnectAttempts = 0;
  /** 重连定时器 */
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  /**
   * 当前的连接实例
   * @warrning 你要知道你自己在做什么
   */
  transport: TransportSocket | null = null;

  /**
   * 会话是否可用：资源绑定成功至流关闭/断线之间为 true。
   * 自动重连期间为 false，重连成功后恢复 true。
   */
  private sessionActive = false;

  /** {@link sessionActive} 的只读视图，供插件判断是否需要继续后台任务 */
  get isSessionActive(): boolean {
    return this.sessionActive;
  }

  /** 插件列表，键是插件名 */
  private readonly pendingPlugins = new Map<
    string,
    {
      func?: PluginConstructor;
      loader?: () => Promise<PluginConstructor>;
      options?: object;
    }
  >();

  /** stanza处理插件，键是NS，值是函数 */
  private readonly stanzaPlugins = new Map<
    string,
    (stanza: XMPPElement) => Record<string, unknown>
  >([]);

  private readonly eventPlugins: {
    [K in keyof EventHandlerMap]: EventPluginMap<K>[];
  } = {
    message: [],
    iq: [],
    presence: [],
    others: [],
  } as const;

  /** 发送/接收管线：stanza 在共享数据上就地传递，处理器不调 next 即短路；插件直接 use 注册 */
  readonly pipeline = new SyncPipeline<{
    send: { stanza: XMPPElement };
    receive: { stanza: XMPPElement };
  }>();

  // [plugin: keyof typeof plugins]: Plugin | undefined;
  [name: string]: unknown;

  /**
   * 创建一个连接
   * @param jid 完整的账号，例如：user@domain.com
   * @param password 密码
   * @param options 自定义配置，一般不需要配置，包括：
   *    - host为连接的url，不要前缀
   *    - protocol为连接协议，xmpp仅node环境可用，ws暂时禁用
   *    - tls为是否启用tls，在本地调试的时候您可能不需要，默认为true
   */
  constructor(jid: string, password: string, options?: Options) {
    super();
    this.jid = new JID(jid);
    this.password = password;

    if (options?.protocol) {
      this.protocol = options.protocol;
    }
    if (options?.host) {
      this.host = options.host;
    } else {
      log.debug("未指定service，将尝试从域名获取");
    }
    if (options?.port) {
      this.port = options.port;
    } else {
      log.info("未指定port，将使用默认端口");
    }
    if (options?.path) {
      this.path = options.path;
    }
    if (options?.tls != null) {
      this.tls = options.tls;
    }
    if (options?.reconnect) {
      this.autoReconnect = options.reconnect;
    }
    if (options?.reconnectInterval) {
      this.reconnectInterval = options.reconnectInterval;
    }
    if (options?.reconnectMaxInterval) {
      this.reconnectMaxInterval = options.reconnectMaxInterval;
    }
    if (options?.reconnectMaxAttempts) {
      this.reconnectMaxAttempts = options.reconnectMaxAttempts;
    }
    // 组合url
    if (this.host && this.protocol) {
      const prefix = this.tls ? `${this.protocol}s` : this.protocol;
      this.url = `${prefix}://${this.host}`;
      if (this.port) {
        this.url += `:${this.port}`;
      }
      if (this.path) {
        this.url += `/${this.path}`;
      }
    }

    // 先注册写出终端，保证未 connect 时 send 也会走到它（未连接即抛错）
    // connect 时 initPlugins() 会清空管线并把它重新注册到所有插件之后
    this.pipeline.use("send", this.write);
  }

  /**
   * 发送管线最内层：先放行让插件改写，再写出最终 stanza；未连接即抛错。
   *
   * 注册在所有插件之后（链尾），插件可在 `next()` 之前改写、`next()` 返回后即已写出。
   */
  private readonly write = (ctx: { stanza: XMPPElement }, next: () => void) => {
    next();
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
  registerPlugin(name: string, func: PluginConstructor, options?: object): void;
  /**
   * 注册内置插件
   * @param name 内置插件名称
   * @param options 传给插件构造函数的配置，省略时插件使用自身默认值
   */
  registerPlugin(name: keyof typeof pluginLoaders, options?: object): void;

  registerPlugin(
    name: string,
    funcOrOptions?: PluginConstructor | object,
    options?: object,
  ): void {
    // 第二参数可能是自定义构造函数，也可能是内置插件的配置
    if (typeof funcOrOptions === "function") {
      this.pendingPlugins.set(name, {
        func: funcOrOptions as PluginConstructor,
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
    let func: PluginConstructor | undefined = reg?.func;
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

  /** 注册插件 */
  private async initPlugins() {
    // 清掉上一次的注册（含写出终端），避免重复调用时叠加
    this.pipeline.clear();
    // 每个已注册插件各做一次依赖闭包，顺带解析并缓存构造函数
    await Promise.all(
      Array.from(this.pendingPlugins.keys(), (name) =>
        this.checkAndRegisterDep(name),
      ),
    );
    // 先全部实例化，保证 init() 里能访问到依赖实例
    for (const [name, { func, options }] of this.pendingPlugins) {
      this[name] = new func!(this, options);
    }
    for (const name of this.pendingPlugins.keys()) {
      (this[name] as InstanceType<PluginConstructor>).init();
    }
    // 写出终端最后注册，位于管线最内层：插件可在 next() 前改写、next() 后读到已写出的 stanza
    this.pipeline.use("send", this.write);
  }

  /**
   * 卸载插件，会自动卸载依赖于该插件的插件，应该由插件自己调用
   * 他只是帮你卸载依赖，记得自己取消监听器
   * @experimental 问题很大，你还需要卸载各种节处理器和事件处理器
   * @param name 插件名称，XEP0000格式
   */
  deregisterPlugin(name: keyof typeof pluginLoaders): void {
    if (!this.pendingPlugins.has(name)) return;
    // 连带卸载依赖它的插件，依赖关系在解析构造函数后已缓存
    for (const [n, reg] of Array.from(this.pendingPlugins)) {
      if (reg.func?.dependencies?.includes(name)) {
        this.deregisterPlugin(n as keyof typeof pluginLoaders);
      }
    }
    this.pendingPlugins.delete(name);
    // 使用Proxy创建错误处理器
    // HACK: 如果要卸载我不得不忽略readonly属性
    this[name as string] = new Proxy(
      {},
      {
        get() {
          throw new Error(`Plugin ${name} has been unregistered`);
        },
      },
    );
  }
  /**
   * 注册stanza处理插件
   * @param NS 命名空间
   * @param handler 处理函数
   */
  registerStanzaPlugin(
    NS: string,
    handler: (stanza: XMPPElement) => Record<string, unknown>,
  ) {
    this.stanzaPlugins.set(NS, handler);
  }

  /**
   * 注册事件插件
   * @template K "message" | "iq" | "presence" | "others"
   * @param eventName 事件名称
   * @param option 选项
   * @param option.tagName 标签名
   * @param option.matcher 匹配器，返回true则触发事件
   */
  registerEventPlugin<K extends keyof EventHandlerMap>(
    eventName: keyof SocketEventMap,
    option: {
      tagName: K;
      matcher: EventHandlerMap[K];
    },
  ) {
    const { tagName, matcher } = option;
    this.eventPlugins[tagName].push({ eventName, matcher });
  }

  async connect() {
    // 已在连接或已连接：拒绝重复调用，避免新旧两个 socket 并存
    if (this.transport && this.transport.status !== Status.DISCONNECTED) {
      throw new Error("连接已在进行中，请先 disconnect() 再连接");
    }
    // 手动连接：取消等待中的自动重连，避免其定时器与本次连接竞争
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    // 复位重连计数与会话状态
    this.reconnectAttempts = 0;
    this.transport = await this.createSocket();
    await this.initPlugins();
    this._setupSocketEvents();
    await this.transport.connect(this.url);
  }

  private async createSocket(): Promise<TransportSocket> {
    if (this.protocol === "http") {
      throw new Error("暂不支持xbosh");
    } else if (this.protocol === "xmpp" && typeof process !== "undefined") {
      log.info("使用xmpp协议");
      const XMPPConnection = (await import("./transport/tcp.js")).default;
      return new XMPPConnection(this.jid, this.password, this.tls);
    } else {
      throw new Error("未知的协议");
    }
  }

  /**
   * 监听socket事件
   * @private 仅供内部使用
   */
  _setupSocketEvents() {
    if (!this.transport) return;
    // socket: open —— 底层连接就绪（此时 XMPP 流尚未协商）
    this.transport.on("open", () => {
      log.info("底层连接已建立");
      this.emit("connect");
    });
    // socket: binded —— XMPP 会话可用
    this.transport.on("binded", () => {
      // RFC 6120 §4.3.6 / §7.7.1：以服务器返回的 bound JID 为准
      if (this.transport && "jid" in this.transport && this.transport.jid) {
        this.jid = this.transport.jid as typeof this.jid;
      }
      // 会话可用，通知前先置位，保证监听器内读到的是新状态
      this.sessionActive = true;
      if (this.reconnectAttempts > 0) {
        // 会话已存在 → 本次是重连成功，只通知重连
        this.emit("reconnected");
        // 绑定成功即视为连接可用，重置退避计数
        this.reconnectAttempts = 0;
      } else {
        this.emit("session:start");
      }
    });
    const msgHandler = (stanza: XMPPElement) => this.onMessage(stanza);
    this.transport.on("stanza", msgHandler);
    // socket: error —— 传输层错误（连接/协商/认证失败、超时等），断开收尾由 close 监听处理
    this.transport.on("error", (error: Error) => {
      log.error("连接错误:", error);
    });
    // socket: stream:end —— 流尾（本端发出或收到对端）：会话正式结束；自动重连期间静默
    this.transport.on("stream:end", () => {
      log.info("XMPP 流已关闭");
      // 流已关闭即会话不可用；自动重连期间不广播事件，但状态须先降级
      this.sessionActive = false;
      if (
        !this.autoReconnect ||
        this.reconnectAttempts >= this.reconnectMaxAttempts
      ) {
        this.emit("session:end");
      }
    });
    // socket: close —— 套接字关闭；可自动重连时静默，重连无望才正式断开
    this.transport.on("close", () => {
      log.info("连接已关闭");
      // 套接字关闭：会话必然不可用（自动重连成功后会重新置位）
      this.sessionActive = false;
      // this.socket?.off("stanza", msgHandler);
      if (
        this.autoReconnect &&
        this.reconnectAttempts < this.reconnectMaxAttempts
      ) {
        // 仅在刚进入断线态时通知一次，后续重试失败会反复触发 close
        if (this.reconnectAttempts === 0) this.emit("connection:lost");
        this.scheduleReconnect();
      } else {
        // 真断开
        this.emit("disconnect");
        this._cleanup();
      }
    });
  }

  /**
   * 断开连接，清除监听器与插件运行时状态
   * @experimental 你在 connection 上注册的事件监听会被清除，重新 connect() 前需自行重新 on()；
   * 插件不必重新 registerPlugin，connect() 会用保留的插件列表自动重建
   */
  disconnect() {
    // 手动断开：把计数顶到上限，让 close 触发的调度判定为已达上限而不重连
    this.reconnectAttempts = Infinity;
    // 清理待执行的重连，避免陈旧定时器抢先
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    // 未连接或已断开：无需等待事件，直接通知并清理
    if (!this.transport || this.transport.status === Status.DISCONNECTED) {
      this.emit("session:end");
      this.emit("disconnect");
      this._cleanup();
      return;
    }
    // 先断开，让 session:end / disconnect 事件到达监听器，close 后再清理
    // this.socket.once("close", () => this._cleanup());
    this.transport.disconnect();
  }

  /**
   * 清除监听器与插件运行时状态。
   * 刻意保留 pendingPlugins：真断开后复用本实例 connect() 时由 initPlugins() 重建插件，调用方无需重新 registerPlugin
   */
  private _cleanup() {
    // 清理待执行的重连定时器，避免残留
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempts = 0;
    this.sessionActive = false;
    // 清除所有监听器（含应用层与插件注册的）
    this.removeAllListeners();
    // 清空插件的注册表项，避免重建插件时重复注册
    this.pipeline.clear();
    // 重建写出终端（clear 会一并清掉），保证断开后 send 仍能抛「连接已断开」
    this.pipeline.use("send", this.write);
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
      this.emit("session:end");
      this.emit("disconnect");
      this._cleanup();
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

    // 拦截器
    const ctx = this.pipeline.run("receive", { stanza });
    stanza = ctx.stanza;

    const tagName = ["message", "iq", "presence"].includes(stanza.tagName)
      ? (stanza.tagName as keyof StanzaHandlerMap)
      : "others";
    const stanzaInstance = this.stanzaInstanceFactory(stanza);
    // 发出节事件
    this.emit(tagName, stanzaInstance);
  }

  private stanzaInstanceFactory(stanza: XMPPElement) {
    const tagName = ["message", "iq", "presence"].includes(stanza.tagName)
      ? (stanza.tagName as keyof StanzaHandlerMap)
      : "others";

    let stanzaInstance;

    if (tagName === "message") {
      stanzaInstance = new Message(stanza, this);
      this.transformExtensions(stanzaInstance);
      for (const eventPlugin of this.eventPlugins[tagName]) {
        if (eventPlugin.matcher(stanzaInstance)) {
          this.emit(eventPlugin.eventName, stanzaInstance);
        }
      }
    } else if (tagName === "iq") {
      stanzaInstance = new Iq(stanza, this);
      this.transformExtensions(stanzaInstance);
      for (const eventPlugin of this.eventPlugins[tagName]) {
        if (eventPlugin.matcher(stanzaInstance)) {
          this.emit(eventPlugin.eventName, stanzaInstance);
        }
      }
      // this.emit("iq", stanzaInstance);
    } else if (tagName === "presence") {
      stanzaInstance = new Presence(stanza, this);
      this.transformExtensions(stanzaInstance);
      for (const eventPlugin of this.eventPlugins[tagName]) {
        if (eventPlugin.matcher(stanzaInstance)) {
          this.emit(eventPlugin.eventName, stanzaInstance);
        }
      }
      // this.emit("presence", stanzaInstance);
    } else {
      stanzaInstance = new StanzaBase(stanza, this);
      this.transformExtensions(stanzaInstance);
      for (const eventPlugin of this.eventPlugins[tagName]) {
        if (eventPlugin.matcher(stanzaInstance)) {
          this.emit(eventPlugin.eventName, stanzaInstance);
        }
      }
      // this.emit("others", stanzaInstance);
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
    // 初始化和断开清理会移除写出终端，状态检查不能只依赖链尾的 write。
    if (!this.transport || this.transport.status === Status.DISCONNECTED) {
      throw new Error("连接已断开");
    }
    if (typeof stanza === "string") {
      stanza = Parser.parse(stanza);
    }
    // id、必备属性、默认命名空间与 xml:lang 都只对三大节有意义，流层元素不受这些约束
    if (!["message", "iq", "presence"].includes(stanza.tagName)) {
      this.pipeline.run("send", { stanza });
      return;
    }
    if (!this.isSessionActive) {
      throw new Error("会话尚未就绪");
    }
    // 检查必须的流属性
    // XXX: 我不清楚需要进行那些检查,多余, 或者缺失

    // 一个拥有特定接收者的节必须拥有一个'to'属性
    // 一个从客户端发送到服务器的由该服务器直接处理的节(例如, presence状态信息)不能拥有'to'属性
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
    // 一个节应该拥有'xml:lang'属性，如果这个节包含了XML字符串数据打算展示给用户
    if (stanza.tagName === "message" && !stanza.getAttribute("xml:lang")) {
      stanza.setAttribute("xml:lang", "en");
    }

    /** 写出终端再次检查传输状态，防止拦截器执行期间断开 {@link write} */
    this.pipeline.run("send", { stanza });
  }

  /**
   * 发送一个stanza，返回一个Promise对象
   * @param stanza 要发送的stanza
   * @param timeout 超时时间，默认30秒
   * @returns 同 id 的响应；会话未就绪、发送失败或超时均 reject
   * @throws 超时时抛出 TimeoutError
   */
  sendAsync(stanza: XMPPElement, timeout = 30000) {
    // 检查必须的流属性
    // XXX: 我不清楚需要进行那些检查,多余, 或者缺失

    // 一个拥有特定接收者的节必须拥有一个'to'属性
    // 一个从客户端发送到服务器的由该服务器直接处理的节(例如, presence状态信息)不能拥有'to'属性
    // if (stanza.tagName === "message" && !stanza.getAttribute("to")) {
    //   throw new Error("message stanza缺少to属性");
    // }
    // if (stanza.tagName === "iq" && !stanza.getAttribute("type")) {
    //   throw new Error("iq stanza缺少type属性");
    // }
    // 如果没有, 服务器会自动填充
    // if (!stanza.getAttribute("from")) {
    //   stanza.setAttribute("from", this.jid.full);
    // }
    if (!stanza.getAttribute("id")) {
      stanza.setAttribute("id", crypto.randomUUID());
    }
    // if (!stanza.namespaceURI) {
    //   stanza.setAttribute("xmlns", "jabber:client");
    // }
    // 一个节应该拥有'xml:lang'属性，如果这个节包含了XML字符串数据打算展示给用户
    // if (stanza.tagName === "message" && !stanza.getAttribute("xml:lang")) {
    //   stanza.setAttribute("xml:lang", "en");
    // }
    const id = stanza.getAttribute("id")!;
    const tagName = (
      ["message", "iq", "presence"].includes(stanza.tagName)
        ? stanza.tagName
        : "others"
    ) as "message" | "iq" | "presence" | "others";
    return new Promise<XMPPElement>((resolve, reject) => {
      const handler = (response: StanzaBase) => {
        if (response.id === id) {
          this.off(tagName, handler);
          clearTimeout(timer);
          resolve(response.xml);
        }
      };
      const timer = setTimeout(() => {
        this.off(tagName, handler);
        reject(new TimeoutError("发送stanza超时"));
      }, timeout);
      timer.unref?.();
      // 先注册监听器再发送,避免漏掉立即到达的响应
      this.on(tagName, handler);
      try {
        this.send(stanza);
      } catch (err) {
        // send 抛错时清理监听器与定时器，防止泄漏
        this.off(tagName, handler);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    });
    // return this.socket.sendAsync(stanza, timeout);
  }
}

import { pluginLoaders } from "./plugins/index";
import type { PluginConstructor } from "./plugins/types";
import { Parser } from "./ltx/Parser";

type PluginRegistry = {
  [K in keyof typeof pluginLoaders]?: InstanceType<
    Awaited<ReturnType<(typeof pluginLoaders)[K]>>
  >;
};

export default Connection;
