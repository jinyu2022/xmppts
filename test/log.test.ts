import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import logger from "../lib/log";

/**
 * log.ts 单元测试：验证日志前缀增强（YYYY-MM-DD HH:mm:ss [LEVEL][logger]）、
 * 字符串首参拼接与增强标记的幂等性；spy console 捕获输出。
 */

/** 形如 `YYYY-MM-DD HH:mm:ss [INFO][demo] ...` 的前缀 */
const PREFIX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[(TRACE|DEBUG|INFO|WARN|ERROR)\]/;

describe("log 增强", () => {
  let infoSpy: MockInstance<typeof console.info>;
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    // loglevel 把 debug 映射到 console.log
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // rebuild 会连同子 logger 一起重建方法，让增强工厂捕获 spy 后的 console
    logger.setLevel("debug");
    logger.rebuild();
  });

  afterEach(() => {
    logger.setLevel("warn");
    infoSpy.mockRestore();
    logSpy.mockRestore();
    logger.rebuild();
  });

  it("标记全局符号，重复求值的副本不重复包装", () => {
    expect(Symbol.for("xmppts.log.enhanced") in logger).toBe(true);
  });

  it("字符串首参拼接到前缀后，保留 console 占位符与后续参数", () => {
    logger.getLogger("demo").info("hello %s", "world");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [first, second] = infoSpy.mock.calls[0] as [string, string];
    expect(first).toMatch(PREFIX);
    expect(first).toMatch(/\[INFO\]\[demo\] hello %s$/);
    expect(second).toBe("world");
  });

  it("非字符串首参作为独立参数排在前缀之后", () => {
    logger.getLogger("demo").info(42, { a: 1 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const args = infoSpy.mock.calls[0];
    expect(args[0]).toMatch(PREFIX);
    expect(args[0]).toMatch(/\[INFO\]\[demo\]$/);
    expect(args[1]).toBe(42);
    expect(args[2]).toEqual({ a: 1 });
  });

  it("无 logger 名称时省略名称段，级别以大写呈现", () => {
    logger.debug("boot");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[DEBUG\] boot$/
    );
  });

  it("多次 rebuild 后前缀不叠加，时间戳为本地 YYYY-MM-DD HH:mm:ss", () => {
    logger.rebuild();
    logger.rebuild();
    logger.getLogger("demo").info("once");

    const [first] = infoSpy.mock.calls.at(-1) as [string];
    expect(first.match(/\[INFO\]\[demo\]/g)).toHaveLength(1);
    expect(first.slice(0, 19)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("函数实参按 thunk 求值，禁用级别下不执行", () => {
    const enabled = vi.fn(() => "lazy");
    logger.getLogger("demo").info(enabled);
    expect(enabled).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toMatch(/\[INFO\]\[demo\] lazy$/);

    logger.setLevel("warn");
    const disabled = vi.fn(() => "never");
    logger.debug(disabled);
    expect(disabled).not.toHaveBeenCalled();
  });
});
