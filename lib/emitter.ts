/**
 * 跨环境事件发射器：浏览器与 Node 通用，不依赖 `node:events`。
 *
 * 覆盖项目实际用到的子集：`on` / `addListener` / `prependListener` / `once` / `off` /
 * `removeListener` / `emit` / `removeAllListeners` / `listenerCount` / `listeners` / `eventNames`。
 *
 * 与 Node `EventEmitter` 的差异：
 * - `emit("error", err)` 没有监听器时**不抛异常**，交给可覆盖的
 *   {@link Emitter.onUnhandledError}，避免一个上层遗漏的 error 监听器让进程崩溃
 * - 不实现 `newListener` / `removeListener` 元事件、`maxListeners`、`captureRejections`
 *
 * 保留的 Node 语义：
 * - 同一函数注册多次会注册多条记录，`off` 每次移除最近注册的一条
 * - `emit` 遍历注册时的监听器集合，监听器内增删监听器不影响本次派发
 *   （只有多监听器时才复制数组；单监听器无需快照）
 * - `once` 在调用前移除自身；`off` 传原函数即可移除
 * - 监听器以 emitter 作为 `this`，异常同步向外传播
 */

import logger from "./log";

const log = logger.getLogger("emitter");

/**
 * 由映射值推导监听器参数元组。
 *
 * 条件类型用元组包裹以避免对联合做分布式展开：`E[K]` 是联合时整体作为一个参数，
 * 这样「联合事件名 + 联合载荷」的调用（如 `emit(tagName, stanza)`）仍然成立。
 */
type EventArgs<T> = [T] extends [void]
  ? []
  : [T] extends [readonly unknown[]]
    ? T
    : [T];

/** 事件名：映射的键；事件名只用字符串，排除 `keyof` 可能带来的 number */
type EventName<E extends object> = keyof E & string;

/** 事件监听器签名：参数由映射值推导 */
type Listener<E extends object, K extends EventName<E>> = (
  ...args: EventArgs<E[K]>
) => unknown;

/**
 * 结构化的事件发射器接口，供只需要事件能力的类型使用（如 `TransportSocket`）。
 *
 * 刻意用接口而非类：class 的私有字段会阻止测试替身（继承 Node `EventEmitter` 的
 * mock）在结构上满足类型。
 */
export interface EmitterLike<E extends object> {
  on<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this;
  addListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this;
  prependListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this;
  once<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this;
  off<K extends EventName<E>>(event: K, listener: Listener<E, K>): this;
  removeListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
  ): this;
  emit<K extends EventName<E>>(event: K, ...args: EventArgs<E[K]>): boolean;
  removeAllListeners(event?: EventName<E>): this;
  listenerCount(event: EventName<E>): number;
  /** 查询类方法的返回类型保持宽松，便于 Node `EventEmitter` 替身在结构上满足本接口 */
  listeners(event: EventName<E>): readonly unknown[];
  eventNames(): (string | symbol)[];
}

/** 内部记录的监听器条目 */
interface ListenerRecord {
  /** 调用方传入的原始函数；`off` 按它比对 */
  fn: InternalListener;
  /** 是否为一次性监听器 */
  once: boolean;
  /** 绑定的中止信号 */
  signal?: AbortSignal;
  /** signal 中止时的清理函数，手动移除时需解绑避免泄漏 */
  onAbort?: () => void;
}

/** 内部统一按 unknown 参数调用，具体参数类型由泛型映射保证 */
type InternalListener = (...args: unknown[]) => unknown;

/** 擦除监听器具体签名；整个模块只在这一处做断言 */
const asInternal = (listener: unknown): InternalListener =>
  listener as InternalListener;

export class Emitter<E extends object> implements EmitterLike<E> {
  /** 没有监听器的 `error` 事件的兜底处理；可整体替换，默认走项目日志 */
  static onUnhandledError: (error: unknown) => void = (error) =>
    log.error("未处理的 error 事件:", error);

  /** 事件名 → 监听器记录（按注册顺序） */
  private readonly records = new Map<EventName<E>, ListenerRecord[]>();

  on<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this {
    return this.add(event, listener, false, options);
  }

  addListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this {
    return this.add(event, listener, false, options);
  }

  /** 插入到该事件监听器链的最前面；连续调用时后插入的更靠前（与 Node 一致） */
  prependListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this {
    return this.add(event, listener, false, options, /* prepend */ true);
  }

  once<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    options?: { signal?: AbortSignal },
  ): this {
    return this.add(event, listener, true, options);
  }

  off<K extends EventName<E>>(event: K, listener: Listener<E, K>): this {
    return this.remove(event, listener);
  }

  removeListener<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
  ): this {
    return this.remove(event, listener);
  }

  emit<K extends EventName<E>>(event: K, ...args: EventArgs<E[K]>): boolean {
    const list = this.records.get(event);
    if (!list || list.length === 0) {
      if (event === "error") {
        Emitter.onUnhandledError(args[0]);
      }
      return false;
    }
    // 单监听器：本次只会调用这一条，无需复制；监听器内新增的监听器留到下次派发
    if (list.length === 1) {
      const record = list[0];
      // once 先摘除再调用，监听器内部抛错也不会残留
      if (record.once) this.removeRecord(event, record);
      Reflect.apply(record.fn, this, args);
      return true;
    }
    // 快照：多监听器时，监听器内增删监听器不影响本次派发
    for (const record of list.slice()) {
      // once 先摘除再调用，监听器内部抛错也不会残留
      if (record.once) this.removeRecord(event, record);
      Reflect.apply(record.fn, this, args);
    }
    return true;
  }

  removeAllListeners(event?: EventName<E>): this {
    if (event === undefined) {
      for (const list of this.records.values()) {
        for (const record of list) this.detachSignal(record);
      }
      this.records.clear();
      return this;
    }
    const list = this.records.get(event);
    if (!list) return this;
    for (const record of list) this.detachSignal(record);
    this.records.delete(event);
    return this;
  }

  listenerCount(event: EventName<E>): number {
    return this.records.get(event)?.length ?? 0;
  }

  listeners<K extends EventName<E>>(event: K): Listener<E, K>[] {
    const list = this.records.get(event);
    if (!list) return [];
    return list.map((record) => record.fn as unknown as Listener<E, K>);
  }

  eventNames(): EventName<E>[] {
    return Array.from(this.records.keys());
  }

  /**
   * 注册一条监听器记录，并按需绑定 abort。
   * @param prepend 为 true 时插入到监听器链头部
   */
  private add<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
    once: boolean,
    options?: { signal?: AbortSignal },
    prepend = false,
  ): this {
    const signal = options?.signal;
    // 已中止的信号视为立即移除，不再注册
    if (signal?.aborted) return this;
    const record: ListenerRecord = {
      fn: asInternal(listener),
      once,
      signal,
    };
    const list = this.records.get(event);
    if (!list) {
      this.records.set(event, [record]);
    } else if (prepend) {
      list.unshift(record);
    } else {
      list.push(record);
    }
    if (signal) {
      const onAbort = () => this.removeRecord(event, record);
      record.onAbort = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return this;
  }

  /** 移除最近注册的一条匹配监听器 */
  private remove<K extends EventName<E>>(
    event: K,
    listener: Listener<E, K>,
  ): this {
    const list = this.records.get(event);
    if (!list) return this;
    const target = asInternal(listener);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].fn === target) {
        this.removeRecord(event, list[i]);
        break;
      }
    }
    return this;
  }

  /** 摘除指定记录（幂等），并解绑其 abort 回调 */
  private removeRecord(event: EventName<E>, record: ListenerRecord): void {
    const list = this.records.get(event);
    if (!list) return;
    const index = list.indexOf(record);
    if (index === -1) return;
    list.splice(index, 1);
    if (list.length === 0) this.records.delete(event);
    this.detachSignal(record);
  }

  /** 解绑 abort 回调，避免已移除的监听器仍被 signal 持有 */
  private detachSignal(record: ListenerRecord): void {
    if (record.signal && record.onAbort) {
      record.signal.removeEventListener("abort", record.onAbort);
    }
  }
}

export default Emitter;
