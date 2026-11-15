import type { Connection } from "@/connection";
import type { pluginLoaders } from "@/plugins";

/** 实例接口 */
interface PluginInstance {
    /** Connection 类只会自动加载依赖，而不会检查服务器的支持情况。*/
    dependencies?: never;
    /**
     * 在这里执行初始化，依赖检查等
     *
     * 此时会话尚未就绪，不能调用 send() 发出任何节（抛出 Error，sendAsync 则 reject）；
     * 需要发出节的逻辑放到 onSessionBound()（每次新会话）或会话事件里执行
     */
    init(): void;
    /**
     * 本流完成资源绑定、进入新会话时的回调。
     *
     * 每次真正完成资源绑定（首次连接、自动重连后的重新绑定）后调用；XEP-0198 流恢复
     * 属会话延续，不调用，插件状态原样保留。
     *
     * 存在的意义：自动重连复用插件实例、不会重新 init()，只在首次绑定执行过的逻辑
     * （如 once("session:start")）在恢复失败后的新会话上不会重跑，需要在此重建。
     *
     * 在 session:start / reconnected 之前调用，此时 `sessionActive` 已为 true，
     * 可直接 sendAsync 重新获取数据。只重建数据，不要重复注册事件处理器或管线中间件
     * （那些属于 init()）。调用是同步的，Connection 不等待返回；每次重新绑定都会调用，
     * 实现须按当前事实从零重建，重复执行结果一致。
     */
    onSessionBound?(): void;
}

/**
 * 插件构造函数接口（包含静态属性）。
 *
 * 第二参数（options）的类型不在这里约束：参数处于逆变位置，
 * 只有 `never` 能容纳各插件自定义的配置类型（`unknown` 会拒绝所有带配置的插件）。
 * 需要校验配置类型时用 {@link PluginOptionsOf} 从具体构造函数推导。
 */
export type PluginFactory = {
    /**
     * 声明依赖的插件。Connection 在 connect() 时自动注册并实例化它们，
     * 不会检查服务器是否支持。
     *
     * 全部插件实例化完成后才统一调用 init()；init() 与会话钩子都按依赖拓扑排序执行，
     * 依赖先于依赖者，没有依赖关系的插件保持注册顺序；依赖成环时按注册顺序打破并记 warn。
     * 需要其他插件已就绪的能力（如服务器 disco）请在会话事件（session:start / reconnected）
     * 后调用其公开方法，不要依赖 init() 与钩子的相对顺序。
     */
    readonly dependencies?: ReadonlyArray<keyof typeof pluginLoaders>;
    new (connection: Connection, ...args: never[]): PluginInstance;
};

/**
 * 提取构造函数第二参数（options）的类型。
 *
 * 用构造参数元组的 length 判断有没有第二参数，而不是按索引去套元组对象，
 * 具名元组、可选参数与 rest 参数都能正确推导。
 * 构造函数未声明第二参数时推导为 `undefined`，即该插件不接受配置。
 */
export type PluginOptionsOf<C> = C extends abstract new (
    ...args: infer P
) => unknown
    ? 2 extends P["length"]
        ? P[1]
        : undefined
    : never;

/**
 * 按插件名推导内置插件的注册选项类型。
 *
 * 选项类型由插件的构造函数声明，注册点据此校验 `registerPlugin` 的第二个参数。
 */
export type PluginOptions<K extends keyof typeof pluginLoaders> =
    PluginOptionsOf<Awaited<ReturnType<(typeof pluginLoaders)[K]>>>;

// 完整的Plugin类型
export type Plugin = PluginInstance;
