import { afterEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "../lib/emitter";

/** 单事件、双参数 */
interface ArgsEvents {
  event: [a: number, b: string];
}

/** 无参数事件（含用于“无监听器”断言的 missing） */
interface NoArgEvents {
  event: [];
  missing: [];
}

/** 同一声明里两个事件名 */
interface MultiEvents {
  a: [];
  b: [];
}

/** error 载荷 */
interface ErrorEvents {
  error: [error: unknown];
}

/** 普通数组载荷：整体作为单个参数 */
interface ArrayEvents {
  items: string[];
}

/** 原始兜底处理器，用例结束后恢复，避免影响其他测试 */
const originalOnUnhandledError = Emitter.onUnhandledError;
const originalOnListenerError = Emitter.onListenerError;

afterEach(() => {
  Emitter.onUnhandledError = originalOnUnhandledError;
  Emitter.onListenerError = originalOnListenerError;
});

describe("Emitter", () => {
  it("on/emit：按注册顺序派发全部参数，this 指向 emitter", () => {
    const emitter = new Emitter<ArgsEvents>();
    const calls: string[] = [];
    const context: unknown[] = [];
    emitter.on("event", function (this: unknown, a: number, b: string) {
      calls.push(`${a}:${b}`);
      context.push(this);
    });
    emitter.on("event", (a: number) => calls.push(`second:${a}`));

    expect(emitter.emit("event", 1, "x")).toBe(true);
    expect(calls).toEqual(["1:x", "second:1"]);
    expect(context[0]).toBe(emitter);
  });

  it("emit：无监听器时返回 false", () => {
    const emitter = new Emitter<NoArgEvents>();
    expect(emitter.emit("missing")).toBe(false);
  });

  it("once：只触发一次，且调用后解除", () => {
    const emitter = new Emitter<NoArgEvents>();
    const fn = vi.fn();
    emitter.once("event", fn);

    emitter.emit("event");
    emitter.emit("event");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount("event")).toBe(0);
  });

  it("once：监听器内递归派发同一事件时不会重复触发", () => {
    const emitter = new Emitter<NoArgEvents>();
    const onceFn = vi.fn();
    let reentered = false;
    emitter.on("event", () => {
      if (reentered) return;
      reentered = true;
      emitter.emit("event");
    });
    emitter.once("event", onceFn);

    emitter.emit("event");

    expect(onceFn).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount("event")).toBe(1);
  });

  it("off：同一函数注册多次时只移除最近的一条", () => {
    const emitter = new Emitter<NoArgEvents>();
    const fn = vi.fn();
    emitter.on("event", fn);
    emitter.on("event", fn);
    expect(emitter.listenerCount("event")).toBe(2);

    emitter.off("event", fn);
    expect(emitter.listenerCount("event")).toBe(1);

    emitter.emit("event");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("off：可移除用原函数注册的 once 监听器", () => {
    const emitter = new Emitter<NoArgEvents>();
    const fn = vi.fn();
    emitter.once("event", fn);
    emitter.off("event", fn);

    emitter.emit("event");
    expect(fn).not.toHaveBeenCalled();
  });

  it("emit：派发使用快照，监听器内增删不影响本次调用", () => {
    const emitter = new Emitter<NoArgEvents>();
    const late = vi.fn();
    const removed = vi.fn();
    emitter.on("event", () => {
      emitter.on("event", late);
      emitter.off("event", removed);
    });
    emitter.on("event", removed);

    emitter.emit("event");
    expect(removed).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    emitter.emit("event");
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("emit：单监听器路径同样不受派发中新增监听器影响", () => {
    const emitter = new Emitter<NoArgEvents>();
    const late = vi.fn();
    emitter.on("event", () => emitter.on("event", late));

    emitter.emit("event");
    expect(late).not.toHaveBeenCalled();

    emitter.emit("event");
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("removeAllListeners：按事件清理与整体清理", () => {
    const emitter = new Emitter<MultiEvents>();
    emitter.on("a", vi.fn());
    emitter.on("a", vi.fn());
    emitter.on("b", vi.fn());

    emitter.removeAllListeners("a");
    expect(emitter.listenerCount("a")).toBe(0);
    expect(emitter.listenerCount("b")).toBe(1);

    emitter.removeAllListeners();
    expect(emitter.eventNames()).toEqual([]);
  });

  it("listeners/eventNames：返回原始监听器", () => {
    const emitter = new Emitter<MultiEvents>();
    const fn = vi.fn();
    emitter.on("a", fn);
    emitter.once("b", fn);

    expect(emitter.listeners("a")).toEqual([fn]);
    expect(emitter.eventNames()).toEqual(["a", "b"]);
  });

  it("emit error：无监听器时不抛异常，交给兜底处理器", () => {
    const emitter = new Emitter<ErrorEvents>();
    const onUnhandledError = vi.fn();
    Emitter.onUnhandledError = onUnhandledError;

    expect(() => emitter.emit("error", new Error("boom"))).not.toThrow();
    expect(onUnhandledError).toHaveBeenCalledTimes(1);
    expect(onUnhandledError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("signal：中止后自动移除监听器", () => {
    const emitter = new Emitter<NoArgEvents>();
    const controller = new AbortController();
    const fn = vi.fn();
    emitter.on("event", fn, { signal: controller.signal });

    controller.abort();
    emitter.emit("event");

    expect(fn).not.toHaveBeenCalled();
    expect(emitter.listenerCount("event")).toBe(0);
  });

  it("signal：已中止的信号不注册监听器", () => {
    const emitter = new Emitter<NoArgEvents>();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();

    emitter.on("event", fn, { signal: controller.signal });
    emitter.once("event", fn, { signal: controller.signal });

    expect(emitter.listenerCount("event")).toBe(0);
  });

  it("signal：once 被正常调用后，再 abort 不会误删其他监听器", () => {
    const emitter = new Emitter<NoArgEvents>();
    const controller = new AbortController();
    const onceFn = vi.fn();
    const other = vi.fn();
    emitter.once("event", onceFn, { signal: controller.signal });
    emitter.on("event", other);

    emitter.emit("event");
    controller.abort();
    emitter.emit("event");

    expect(onceFn).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it("signal：派发过程中被中止的监听器不再执行", () => {
    const emitter = new Emitter<NoArgEvents>();
    const controller = new AbortController();
    const aborted = vi.fn();
    emitter.on("event", () => controller.abort());
    emitter.on("event", aborted, { signal: controller.signal });

    emitter.emit("event");

    expect(aborted).not.toHaveBeenCalled();
    expect(emitter.listenerCount("event")).toBe(1);
  });

  it("signal：once 记录在派发中被中止时不投递", () => {
    const emitter = new Emitter<NoArgEvents>();
    const controller = new AbortController();
    const onceFn = vi.fn();
    emitter.on("event", () => controller.abort());
    emitter.once("event", onceFn, { signal: controller.signal });

    emitter.emit("event");

    expect(onceFn).not.toHaveBeenCalled();
    expect(emitter.listenerCount("event")).toBe(1);
  });

  it("emit：监听器抛错不向外传播，同事件其余监听器继续执行", () => {
    const emitter = new Emitter<NoArgEvents>();
    const onListenerError = vi.fn();
    Emitter.onListenerError = onListenerError;
    const after = vi.fn();
    emitter.on("event", () => {
      throw new Error("listener failed");
    });
    emitter.on("event", after);

    expect(() => emitter.emit("event")).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(onListenerError.mock.calls[0][0]).toBe("event");
    expect(onListenerError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("emit：单监听器抛错同样被隔离，且 once 记录不残留", () => {
    const emitter = new Emitter<NoArgEvents>();
    const onListenerError = vi.fn();
    Emitter.onListenerError = onListenerError;
    emitter.once("event", () => {
      throw new Error("once failed");
    });

    expect(() => emitter.emit("event")).not.toThrow();
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount("event")).toBe(0);
  });

  it("emit：async 监听器的拒绝交给 onListenerError", async () => {
    const emitter = new Emitter<NoArgEvents>();
    const onListenerError = vi.fn();
    Emitter.onListenerError = onListenerError;
    const after = vi.fn();
    emitter.on("event", async () => {
      await Promise.resolve();
      throw new Error("async failed");
    });
    emitter.on("event", after);

    emitter.emit("event");
    expect(after).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onListenerError).toHaveBeenCalledTimes(1));
    expect(onListenerError.mock.calls[0][0]).toBe("event");
    expect(onListenerError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("类型约束：事件名与载荷由映射决定（tsc 校验）", () => {
    const emitter = new Emitter<ArgsEvents>();
    // @ts-expect-error 事件名不在映射中
    emitter.on("missing", () => {});
    // @ts-expect-error 第二个参数应为 string
    emitter.emit("event", 1, 2);
    // @ts-expect-error 缺少第二个参数
    emitter.emit("event", 1);
  });

  it("类型约束：数组载荷整体作为单个参数，不做 rest 展开", () => {
    const emitter = new Emitter<ArrayEvents>();
    const fn = vi.fn();
    emitter.on("items", fn);

    emitter.emit("items", ["a", "b"]);
    expect(fn).toHaveBeenCalledWith(["a", "b"]);

    // @ts-expect-error 数组载荷不能展开成多个参数
    emitter.emit("items", "a", "b");
  });
});
