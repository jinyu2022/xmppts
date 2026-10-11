import { describe, expect, it } from "vitest";
import * as plugins from "../../lib/plugins";
import { pluginLoaders } from "../../lib/plugins";

/**
 * plugins barrel 一致性测试：
 * 保证插件静态导出、懒加载映射、默认导出（构造函数）三者同步，防止新增插件时漏登记。
 */

describe("plugins barrel", () => {
  it("pluginLoaders 的键与静态导出集合完全一致", () => {
    const exported = Object.keys(plugins)
      .filter((key) => key !== "pluginLoaders")
      .sort();
    expect(Object.keys(pluginLoaders).sort()).toEqual(exported);
    expect(exported).toHaveLength(24);
  });

  it("每个 loader 解析出可实例化的插件类，且与静态导出同一引用", async () => {
    for (const [name, loader] of Object.entries(pluginLoaders)) {
      const ctor = await loader();
      expect(typeof ctor).toBe("function");
      expect(typeof ctor.prototype.init).toBe("function");
      expect(plugins[name as keyof typeof plugins]).toBe(ctor);
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
