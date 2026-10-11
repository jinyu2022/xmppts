import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

/** `@` 别名指向 lib/，打包时重写为相对路径 */
const libDir = fileURLToPath(new URL("./lib", import.meta.url));

export default defineConfig({
  entry: "index.ts",
  // 等价 Rollup 的 preserveModules：产物与 lib/ 目录结构一一对应
  unbundle: true,
  root: ".",
  alias: { "@": libDir },
  platform: "node",
  target: ["node20", "es2022"],
  // platform 为 node 时默认 true，会把产物扩展名改成 .mjs，与 exports 字段不符
  fixedExtension: false,
  sourcemap: true,
  dts: true,
});
