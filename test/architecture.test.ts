import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as rootEntry from "../index";
import { pluginLoaders } from "../lib/plugins";

/**
 * 架构守卫测试。
 *
 * 这三条不变式靠单个模块无法表达，只能从模块之间的关系上验证：
 * 1. 包入口只暴露 Client，内部类型不随实现变动泄漏成公共 API；
 * 2. 插件表保持全动态 import，避免静态引用把未用插件拖进打包结果；
 * 3. lib 内部不出现未登记的循环依赖，防止模块逐步形成强连通分量。
 *
 * 依赖图按源码文本解析，只统计 lib 内部的相对路径与 `@/` 别名导入。
 */

/** 仓库根目录（本文件位于 test/） */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 库源码目录 */
const LIB_DIR = join(REPO_ROOT, "lib");
/** 路径别名前缀，与 tsconfig / tsdown 配置一致 */
const ALIAS_PREFIX = "@/";

/**
 * 已知且已确认无法拆分的循环依赖。
 *
 * 新增条目是设计决定而非形式：必须在条目上写清两个模块为什么互相需要。
 * 数组内每项是 lib 相对路径（/ 分隔），检测结果会排序后与之一一比对。
 */
const KNOWN_CYCLES: readonly (readonly string[])[] = [
  // 插件契约需要 Connection 与 pluginLoaders 的类型，stanza 需要 Connection 的类型，
  // Connection 又需要 stanza 的运行时类；三条边均为类型引用，不存在初始化顺序问题。
  ["connection.ts", "plugins/types.ts", "stanza.ts"],
  // Element 用容器类型保存子元素，容器与选择器又都用 Element 定位节点。
  // Element 与 QuerySelector 是运行时互引，但只在方法调用时求值，不在模块初始化期使用。
  ["ltx/Element.ts", "ltx/QuerySelector.ts", "ltx/XMPPElementCollection.ts"],
  // typing.ts 引用管线事件类型，stream-connection 运行时需要 typing 的 Status 常量。
  ["transport/stream-connection.ts", "transport/typing.ts"],
];

/** 收集 lib 下参与构建的源文件（排除测试文件） */
function sourceFiles(dir: string = LIB_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return [];
    if (/\.(test|spec)\.ts$/.test(path)) return [];
    return [path];
  });
}

/**
 * 把模块说明符解析为 lib 内的真实文件。
 *
 * 返回 undefined 表示外部依赖、node 内置模块或无法定位的路径。
 * 源码里两种写法并存：多数目录用 `./x`，ltx 目录沿用上游风格写成 `./x.js`，
 * 因此候选列表要同时覆盖 `.ts` 与 `.js` 后缀映射。
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  known: Set<string>,
): string | undefined {
  let base: string;
  if (specifier.startsWith(ALIAS_PREFIX)) {
    base = join(LIB_DIR, specifier.slice(ALIAS_PREFIX.length));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return undefined;
  }

  const candidates = [
    base,
    `${base}.ts`,
    join(base, "index.ts"),
    base.endsWith(".js") ? `${base.slice(0, -".js".length)}.ts` : undefined,
  ].filter((candidate): candidate is string => candidate !== undefined);

  return candidates.find((candidate) => known.has(candidate));
}

/**
 * 构建模块导入图。
 *
 * 只统计静态导入：`import ... from`、`export ... from` 与副作用导入 `import "..."`。
 * 动态 `import()` 由加载器按需触发，不参与模块初始化顺序，若算作边，
 * 插件懒加载表会与所有插件形成一个恒定的大分量，失去诊断价值。
 *
 * 类型导入同样算边：它们在运行时被擦除，但仍是作者与类型检查器要跟随的依赖，
 * 循环通常也是这样一点点形成的。
 */
function buildImportGraph(files: string[]): Map<string, string[]> {
  const known = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const specifiers = [
      ...readFileSync(file, "utf8").matchAll(
        /(?:\bfrom\s*|\bimport\s+)(["'])([^"']+)\1/g,
      ),
    ].map((match) => match[2]);

    const edges = specifiers
      .map((specifier) => resolveSpecifier(file, specifier, known))
      .filter((target): target is string => target !== undefined && target !== file);

    graph.set(file, [...new Set(edges)]);
  }

  return graph;
}

/**
 * Tarjan 强连通分量（迭代版本）。
 *
 * 显式栈模拟递归，避免深层依赖链触发调用栈上限。
 * 返回的每个分量内部顺序不保证，调用方应自行排序。
 */
function stronglyConnectedComponents(graph: Map<string, string[]>): string[][] {
  const indexOf = new Map<string, number>();
  const lowOf = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  for (const root of graph.keys()) {
    if (indexOf.has(root)) continue;

    /** 每帧记录当前节点与下一条待访问边的下标 */
    const frames: Array<{ node: string; edge: number }> = [
      { node: root, edge: 0 },
    ];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const { node } = frame;

      // 首次进入该节点：分配序号并入栈
      if (frame.edge === 0) {
        indexOf.set(node, nextIndex);
        lowOf.set(node, nextIndex);
        nextIndex += 1;
        stack.push(node);
        onStack.add(node);
      }

      const edges = graph.get(node) ?? [];
      if (frame.edge < edges.length) {
        const target = edges[frame.edge];
        frame.edge += 1;
        if (!indexOf.has(target)) {
          frames.push({ node: target, edge: 0 });
        } else if (onStack.has(target)) {
          lowOf.set(node, Math.min(lowOf.get(node)!, indexOf.get(target)!));
        }
        continue;
      }

      // 所有边已访问：根节点构成一个强连通分量
      if (lowOf.get(node) === indexOf.get(node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        components.push(component);
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        lowOf.set(
          parent.node,
          Math.min(lowOf.get(parent.node)!, lowOf.get(node)!),
        );
      }
    }
  }

  return components;
}

/** 全部循环依赖，按 lib 相对路径（/ 分隔）表示并排序 */
function importCycles(): string[][] {
  return stronglyConnectedComponents(buildImportGraph(sourceFiles()))
    .filter((component) => component.length > 1)
    .map((component) =>
      component.map((file) => relative(LIB_DIR, file).split("\\").join("/")).sort(),
    )
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

describe("包入口导出面", () => {
  it("根入口只导出 Client", () => {
    expect(Object.keys(rootEntry).sort()).toEqual(["Client"]);
  });
});

describe("插件懒加载表", () => {
  it("每个 loader 都是函数", () => {
    for (const [name, loader] of Object.entries(pluginLoaders)) {
      expect(typeof loader, `${name} 不是函数`).toBe("function");
    }
  });

  it("表中不出现静态 import 或 re-export", () => {
    const source = readFileSync(join(LIB_DIR, "plugins", "index.ts"), "utf8");
    // 注释里允许出现示例代码，先剔除以 ///* 开头的行再检查
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");

    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\bfrom\s+["']/);
  });
});

describe("模块依赖", () => {
  it("循环依赖与已知清单一致", () => {
    const expected = KNOWN_CYCLES.map((cycle) => [...cycle].sort()).sort(
      (a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1),
    );
    expect(importCycles()).toEqual(expected);
  });
});
