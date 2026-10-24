import { describe, expect, it } from "vitest";
import { pluginLoaders } from "../../lib/plugins";

/**
 * pluginLoaders 一致性测试：
 * 保证每个登记项都能解析出可实例化的插件类，且依赖指向已登记的项。
 */

describe("pluginLoaders", () => {
  it("键非空且唯一", () => {
    const keys = Object.keys(pluginLoaders);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每个 loader 解析出可实例化的插件类", async () => {
    for (const loader of Object.values(pluginLoaders)) {
      const ctor = await loader();
      expect(typeof ctor).toBe("function");
      expect(typeof ctor.prototype.init).toBe("function");
    }
  });

  it("loader 重复调用得到同一构造函数（命中模块缓存）", async () => {
    const first = await pluginLoaders.XEP0030();
    const second = await pluginLoaders.XEP0030();
    expect(first).toBe(second);
  });

  it("插件的静态依赖均指向已登记的内置插件", async () => {
    for (const loader of Object.values(pluginLoaders)) {
      // 部分插件（如 RFC6121）未声明静态 dependencies
      const { dependencies } = (await loader()) as {
        dependencies?: readonly string[];
      };
      for (const dep of dependencies ?? []) {
        expect(pluginLoaders).toHaveProperty(dep);
      }
    }
  });
});
