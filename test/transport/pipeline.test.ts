import { describe, expect, it, vi } from "vitest";
import { Pipeline, SyncPipeline } from "../../lib/transport/pipeline";

/**
 * Pipeline / SyncPipeline 单元测试。
 * 覆盖处理器顺序、共享数据引用、短路、错误传播与 error 接管、clear 语义。
 */

interface Events {
  [key: string]: object;
  ev: { trace: string[] };
  other: { n: number };
}

describe("Pipeline（异步）", () => {
  it("按注册顺序执行并返回同一数据引用", async () => {
    const pipeline = new Pipeline<Events>();
    const data = { trace: [] as string[] };
    pipeline.use("ev", (d, next) => {
      d.trace.push("first");
      return next();
    });
    pipeline.use("ev", (d, next) => {
      d.trace.push("second");
      return next();
    });

    const result = await pipeline.run("ev", data);
    expect(result).toBe(data);
    expect(data.trace).toEqual(["first", "second"]);
  });

  it("use 支持链式调用；未注册的事件点直接返回数据", async () => {
    const pipeline = new Pipeline<Events>();
    expect(pipeline.use("ev", (_d, next) => next())).toBe(pipeline);

    const data = { n: 1 };
    await expect(pipeline.run("other", data)).resolves.toBe(data);
  });

  it("处理器不调用 next 时短路后续处理器", async () => {
    const pipeline = new Pipeline<Events>();
    const later = vi.fn();
    pipeline.use("ev", (d) => {
      d.trace.push("stop");
    });
    pipeline.use("ev", (_d, next) => {
      later();
      return next();
    });

    await pipeline.run("ev", { trace: [] });
    expect(later).not.toHaveBeenCalled();
  });

  it("处理器抛错时中断整条链并向上抛出", async () => {
    const pipeline = new Pipeline<Events>();
    const later = vi.fn();
    pipeline.use("ev", () => {
      throw new Error("boom");
    });
    pipeline.use("ev", (_d, next) => {
      later();
      return next();
    });

    await expect(pipeline.run("ev", { trace: [] })).rejects.toThrow("boom");
    expect(later).not.toHaveBeenCalled();
  });

  it("注册 error 后错误交给处理器，链中断且不抛出", async () => {
    const pipeline = new Pipeline<Events>();
    const onError = vi.fn();
    const later = vi.fn();
    pipeline.error(onError);
    pipeline.use("ev", () => {
      throw new Error("handled");
    });
    pipeline.use("ev", (_d, next) => {
      later();
      return next();
    });

    const data = { trace: [] };
    await expect(pipeline.run("ev", data)).resolves.toBe(data);
    expect(later).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "ev", data);
  });

  it("clear 移除处理器但保留 error 接管", async () => {
    const pipeline = new Pipeline<Events>();
    const onError = vi.fn();
    pipeline.error(onError);
    pipeline.use("ev", () => {
      throw new Error("first");
    });

    pipeline.clear();
    await expect(pipeline.run("ev", { trace: [] })).resolves.toEqual({ trace: [] });
    expect(onError).not.toHaveBeenCalled();

    pipeline.use("ev", () => {
      throw new Error("second");
    });
    await pipeline.run("ev", { trace: [] });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "ev", { trace: [] });
  });

  it("异步错误处理器被 await，处理器完成后 run 才完成", async () => {
    const pipeline = new Pipeline<Events>();
    const order: string[] = [];
    pipeline.error(async () => {
      await Promise.resolve();
      order.push("handled");
    });
    pipeline.use("ev", () => {
      throw new Error("slow");
    });

    await pipeline.run("ev", { trace: [] });
    expect(order).toEqual(["handled"]);
  });
});

describe("SyncPipeline（同步）", () => {
  it("同步执行全部处理器并返回同一数据引用", () => {
    const pipeline = new SyncPipeline<Events>();
    const data = { trace: [] as string[] };
    pipeline.use("ev", (d, next) => {
      d.trace.push("first");
      next();
    });
    pipeline.use("ev", (d, next) => {
      d.trace.push("second");
      next();
    });

    const result = pipeline.run("ev", data);
    expect(result).toBe(data);
    expect(data.trace).toEqual(["first", "second"]);
  });

  it("run 返回时链已走完，不回退到微任务", () => {
    const pipeline = new SyncPipeline<Events>();
    let done = false;
    pipeline.use("ev", (_d, next) => {
      next();
      done = true;
    });

    pipeline.run("ev", { trace: [] });
    expect(done).toBe(true);
  });

  it("不调用 next 短路；抛错中断并可被 error 接管", () => {
    const pipeline = new SyncPipeline<Events>();
    const onError = vi.fn();
    const later = vi.fn();
    pipeline.error(onError);
    pipeline.use("ev", (d) => {
      d.trace.push("stop");
      throw new Error("sync boom");
    });
    pipeline.use("ev", (_d, next) => {
      later();
      next();
    });

    expect(() => pipeline.run("ev", { trace: [] })).not.toThrow();
    expect(later).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "ev", { trace: ["stop"] });
  });

  it("use 链式、未注册事件直接返回、clear 保留 error", () => {
    const pipeline = new SyncPipeline<Events>();
    expect(pipeline.use("ev", (_d, next) => next())).toBe(pipeline);

    const data = { n: 2 };
    expect(pipeline.run("other", data)).toBe(data);

    const onError = vi.fn();
    pipeline.error(onError);
    pipeline.clear();
    pipeline.use("ev", () => {
      throw new Error("after clear");
    });
    pipeline.run("ev", { trace: [] });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
