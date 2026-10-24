import { describe, expect, it, vi } from "vitest";
import { Pipeline, SyncPipeline } from "../../lib/transport/pipeline";

/**
 * Pipeline / SyncPipeline 单元测试。
 * 覆盖处理器顺序、共享数据引用、短路、错误传播、终端与 clear 语义。
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

  it("clear 移除处理器", async () => {
    const pipeline = new Pipeline<Events>();
    const later = vi.fn();
    pipeline.use("ev", (_d, next) => {
      later();
      return next();
    });

    pipeline.clear();
    await expect(pipeline.run("ev", { trace: [] })).resolves.toEqual({ trace: [] });
    expect(later).not.toHaveBeenCalled();
  });

  it("终端固定在中间件之后，clear 后仍保留", async () => {
    const pipeline = new Pipeline<Events>();
    pipeline.terminal("ev", (d, next) => {
      d.trace.push("terminal");
      return next();
    });
    pipeline.use("ev", (d, next) => {
      d.trace.push("middleware");
      return next();
    });

    const data = { trace: [] as string[] };
    await pipeline.run("ev", data);
    expect(data.trace).toEqual(["middleware", "terminal"]);

    pipeline.clear();
    const afterClear = { trace: [] as string[] };
    await pipeline.run("ev", afterClear);
    expect(afterClear.trace).toEqual(["terminal"]);
  });

  it("中间件在 next() 返回后即可确认终端已完成", async () => {
    const pipeline = new Pipeline<Events>();
    let written = false;
    pipeline.terminal("ev", (_d, next) => {
      written = true;
      return next();
    });
    let observedAfterNext = false;
    pipeline.use("ev", async (_d, next) => {
      await next();
      observedAfterNext = written;
    });

    await pipeline.run("ev", { trace: [] });
    expect(observedAfterNext).toBe(true);
  });

  it("同一事件点重复注册终端抛错", () => {
    const pipeline = new Pipeline<Events>();
    pipeline.terminal("ev", (_d, next) => next());
    expect(() => pipeline.terminal("ev", (_d, next) => next())).toThrow(
      "已存在终端",
    );
  });

  it("终端抛错向上抛出", async () => {
    const pipeline = new Pipeline<Events>();
    pipeline.terminal("ev", () => {
      throw new Error("terminal boom");
    });

    await expect(pipeline.run("ev", { trace: [] })).rejects.toThrow(
      "terminal boom",
    );
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

  it("不调用 next 短路；抛错中断并向上抛出", () => {
    const pipeline = new SyncPipeline<Events>();
    const later = vi.fn();
    pipeline.use("ev", (d) => {
      d.trace.push("stop");
      throw new Error("sync boom");
    });
    pipeline.use("ev", (_d, next) => {
      later();
      next();
    });

    expect(() => pipeline.run("ev", { trace: [] })).toThrow("sync boom");
    expect(later).not.toHaveBeenCalled();
  });

  it("use 链式、未注册事件直接返回、clear 清空中间件", () => {
    const pipeline = new SyncPipeline<Events>();
    expect(pipeline.use("ev", (_d, next) => next())).toBe(pipeline);

    const data = { n: 2 };
    expect(pipeline.run("other", data)).toBe(data);

    const later = vi.fn();
    pipeline.use("ev", (_d, next) => {
      later();
      next();
    });
    pipeline.clear();
    pipeline.run("ev", { trace: [] });
    expect(later).not.toHaveBeenCalled();
  });

  it("终端固定在中间件之后，clear 后仍保留", () => {
    const pipeline = new SyncPipeline<Events>();
    pipeline.terminal("ev", (d, next) => {
      d.trace.push("terminal");
      next();
    });
    pipeline.use("ev", (d, next) => {
      d.trace.push("middleware");
      next();
    });

    const data = { trace: [] as string[] };
    pipeline.run("ev", data);
    expect(data.trace).toEqual(["middleware", "terminal"]);

    pipeline.clear();
    const afterClear = { trace: [] as string[] };
    pipeline.run("ev", afterClear);
    expect(afterClear.trace).toEqual(["terminal"]);
  });

  it("中间件在 next() 返回后即可确认终端已完成", () => {
    const pipeline = new SyncPipeline<Events>();
    let written = false;
    pipeline.terminal("ev", (_d, next) => {
      written = true;
      next();
    });
    let observedAfterNext = false;
    pipeline.use("ev", (_d, next) => {
      next();
      observedAfterNext = written;
    });

    pipeline.run("ev", { trace: [] });
    expect(observedAfterNext).toBe(true);
  });

  it("同一事件点重复注册终端抛错", () => {
    const pipeline = new SyncPipeline<Events>();
    pipeline.terminal("ev", (_d, next) => next());
    expect(() => pipeline.terminal("ev", (_d, next) => next())).toThrow(
      "已存在终端",
    );
  });
});
