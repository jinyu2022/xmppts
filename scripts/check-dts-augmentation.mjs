#!/usr/bin/env node
/**
 * 校验 dist 中的 module augmentation 目标是否可被消费者解析。
 *
 * `declare module "..."` 的模块名属于类型层字符串，tsdown/rolldown 的 alias
 * 只重写 import/export 说明符，不会重写它。因此这里禁止 `@/` 形式的产物：
 * augmentation 必须使用相对路径（相对声明所在文件），dist 的目录结构与
 * lib/ 同构，相对路径在消费者侧同样成立。
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(projectRoot, "dist");

/** 只匹配 `declare module "<specifier>"` 的模块名 */
const DECLARE_MODULE_RE = /declare\s+module\s+(["'])([^"']+)\1/g;

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectDts(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectDts(full)));
    else if (entry.name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

let files;
try {
  files = await collectDts(distDir);
} catch {
  console.error(`[check-dts] 未找到构建产物 ${distDir}，请先运行 npm run build`);
  process.exit(1);
}

const invalid = [];
let specifierCount = 0;

for (const file of files) {
  const rel = path.relative(projectRoot, file);
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(DECLARE_MODULE_RE)) {
    const specifier = match[2];
    specifierCount++;
    if (specifier.startsWith("@/")) invalid.push({ rel, specifier });
  }
}

if (invalid.length > 0) {
  console.error("[check-dts] 产物中存在无法解析的 module augmentation：");
  for (const { rel, specifier } of invalid) {
    console.error(`  ${rel}: declare module "${specifier}"`);
  }
  console.error(
    '\n请把源码中的 @/ 别名改为相对路径（相对声明所在文件），例如 declare module "../../connection"。'
  );
  process.exit(1);
}

console.log(
  `[check-dts] 通过：扫描 ${files.length} 个 .d.ts，${specifierCount} 处 declare module 说明符均可解析`
);
