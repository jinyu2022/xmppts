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
     * 需要发出节的逻辑应监听 session:start 事件后再执行
     */
    init(): void;
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
     * 这里只保证依赖实例存在，不承诺 init() 顺序：全部插件实例化完成后才统一调用 init()。
     * 需要其他插件已就绪的能力（如服务器 disco）请在 session:start 后调用其公开方法，
     * 不要依赖 init() 的先后。
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
