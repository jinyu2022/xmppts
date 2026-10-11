/**
 * 异步数据处理器：直接操作共享数据（就地修改），调用 `next` 放行后续处理器。
 *
 *
 * 链路由 {@link Pipeline.run} 异步串联；需要同步返回的调用链见 {@link SyncPipeline}。
 *
 * @typeParam T 在管线中流动的数据类型
 * @param data 共享数据（所有处理器同一个引用，就地修改）
 * @param next 放行后续处理器，返回下游链完成的 promise
 */
type PipelineMiddleware<T extends object> = (
  data: T,
  next: () => Promise<void>,
) => void | Promise<void>;

/**
 * 异步管线：固定事件点触发，处理器共享数据就地修改。
 *
 * 调用方在固定位置 `await run`，所有处理器收到
 * 同一数据引用，按注册顺序执行（可调用 next 放行、短路）；
 * 调用方无需认识任何具体插件。
 *
 * use/run 时依据事件名推导对应的载荷类型。
 */
export class Pipeline<T extends Record<string, object>> {
  private readonly middlewares = new Map<
    Extract<keyof T, string>,
    PipelineMiddleware<T[Extract<keyof T, string>]>[]
  >();
  private errorHandler: PipelineErrorHandler<T> | null = null;

  /**
   * 注册数据处理器。
   *
   * 同一事件点的处理器按注册顺序执行；先注册的先处理数据。
   *
   * @param event 要挂载的事件点
   * @param middleware 数据处理器，data 参数的类型由事件名推导
   * @remarks 处理器内放行后续必须 `return next()` 或 `await next()`，
   * 见 {@link PipelineMiddleware}。
   * @returns this，支持链式调用
   */
  use<E extends Extract<keyof T, string>>(
    event: E,
    middleware: PipelineMiddleware<T[E]>,
  ): this {
    const list = this.middlewares.get(event) ?? [];
    list.push(middleware as PipelineMiddleware<T[Extract<keyof T, string>]>);
    this.middlewares.set(event, list);
    return this;
  }

  /**
   * 注册错误处理器：链中任一处理器抛错时被调用。
   *
   * 未注册时错误直接向上抛出；注册后错误不会逃逸，
   * 由处理器决定是终止连接还是降级继续。
   *
   * @param handler 错误处理器
   * @returns this，支持链式调用
   */
  error(handler: PipelineErrorHandler<T>): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * 触发事件：数据按注册顺序经过所有处理器。
   *
   * 调用方在流程固定位置 `await` 本方法，将初始数据投入管线；
   * 所有处理器共享同一数据引用，就地修改，无需返回值接力。
   *
   * @param event 要触发的事件点
   * @param data 初始数据，所有处理器共享此引用并就地修改
   * @returns 同一数据引用（处理器就地修改后的结果）
   * @remarks 处理器可不调用 next 短路后续链；
   * 任一处理器抛错会中断整条链；
   * 已注册 {@link Pipeline.error} 时交给错误处理器，否则向上抛出。
   */
  async run<E extends Extract<keyof T, string>>(
    event: E,
    data: T[E],
  ): Promise<T[E]> {
    const middlewares = this.middlewares.get(event) ?? [];
    const dispatch = async (index: number): Promise<void> => {
      if (index >= middlewares.length) return;
      try {
        await middlewares[index](data, () => dispatch(index + 1));
      } catch (error) {
        if (this.errorHandler) {
          await this.errorHandler(error, event, data);
          return; // 错误处理器接管，链中断
        }
        throw error;
      }
    };
    await dispatch(0);
    return data;
  }

  /** 清空所有事件点的处理器（保留 {@link Pipeline.error} 注册的错误处理器） */
  clear(): void {
    for (const list of this.middlewares.values()) list.length = 0;
  }
}

/**
 * 管线错误处理器：链中任一处理器抛错时被调用（参考 xmpp.js middleware 的 errorHandler）。
 *
 * @typeParam Events 事件点到载荷类型的映射，data 参数取其联合类型
 */
type PipelineErrorHandler<T extends Record<string, object>> = (
  error: unknown,
  event: Extract<keyof T, string>,
  data: T[Extract<keyof T, string>],
) => void | Promise<void>;

/**
 * 同步数据处理器：与 {@link PipelineMiddleware} 语义相同，但 `next` 同步放行、无返回值。
 *
 * @typeParam T 在管线中流动的数据类型
 * @param data 共享数据（所有处理器同一个引用，就地修改）
 * @param next 同步放行后续处理器
 */
type SyncPipelineMiddleware<T extends object> = (
  data: T,
  next: () => void,
) => void;

/**
 * 同步管线错误处理器：链中任一处理器抛错时被调用。
 *
 * @typeParam Events 事件点到载荷类型的映射，data 参数取其联合类型
 */
type SyncPipelineErrorHandler<T extends Record<string, object>> = (
  error: unknown,
  event: Extract<keyof T, string>,
  data: T[Extract<keyof T, string>],
) => void;

/**
 * 同步管线：{@link Pipeline} 的同步版，供必须同步返回的调用链（如 `Connection.send`）使用。
 *
 * 处理器须全为同步函数，调用 `next()` 同步执行下游，`run` 返回时整条链已走完。
 */
export class SyncPipeline<T extends Record<string, object>> {
  private readonly middlewares = new Map<
    Extract<keyof T, string>,
    SyncPipelineMiddleware<T[Extract<keyof T, string>]>[]
  >();
  private errorHandler: SyncPipelineErrorHandler<T> | null = null;

  /**
   * 注册数据处理器。
   *
   * 同一事件点的处理器按注册顺序执行；先注册的先处理数据。
   *
   * @param event 要挂载的事件点
   * @param middleware 数据处理器，data 参数的类型由事件名推导
   * @remarks 处理器内放行后续直接调用 `next()`，其返回值无意义。
   * @returns this，支持链式调用
   */
  use<E extends Extract<keyof T, string>>(
    event: E,
    middleware: SyncPipelineMiddleware<T[E]>,
  ): this {
    const list = this.middlewares.get(event) ?? [];
    list.push(middleware as SyncPipelineMiddleware<T[Extract<keyof T, string>]>);
    this.middlewares.set(event, list);
    return this;
  }

  /**
   * 注册错误处理器：链中任一处理器抛错时被调用。
   *
   * 未注册时错误直接向上抛出；注册后错误不会逃逸，
   * 由处理器决定是终止连接还是降级继续。
   *
   * @param handler 错误处理器
   * @returns this，支持链式调用
   */
  error(handler: SyncPipelineErrorHandler<T>): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * 触发事件：数据同步经过所有处理器。
   *
   * @param event 要触发的事件点
   * @param data 初始数据，所有处理器共享此引用并就地修改
   * @returns 同一数据引用（处理器就地修改后的结果）
   * @remarks 处理器可不调用 next 短路后续链；
   * 任一处理器抛错会中断整条链；
   * 已注册 {@link SyncPipeline.error} 时交给错误处理器，否则向上抛出。
   */
  run<E extends Extract<keyof T, string>>(event: E, data: T[E]): T[E] {
    const middlewares = this.middlewares.get(event) ?? [];
    const dispatch = (index: number): void => {
      if (index >= middlewares.length) return;
      try {
        middlewares[index](data, () => dispatch(index + 1));
      } catch (error) {
        if (this.errorHandler) {
          this.errorHandler(error, event, data);
          return; // 错误处理器接管，链中断
        }
        throw error;
      }
    };
    dispatch(0);
    return data;
  }

  /** 清空所有事件点的处理器（保留 {@link SyncPipeline.error} 注册的错误处理器） */
  clear(): void {
    for (const list of this.middlewares.values()) list.length = 0;
  }
}