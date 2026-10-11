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

/** 构造函数接口（包含静态属性） */ 
export interface PluginConstructor {
    /** Connection 类只会自动加载依赖，而不会检查服务器的支持情况。*/
    readonly dependencies?: ReadonlyArray<keyof typeof pluginLoaders>;
    new (connection: Connection, options?: object): PluginInstance;
}
// 完整的Plugin类型
export type Plugin = PluginInstance;
