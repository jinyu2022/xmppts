import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

/** `@` 别名指向 lib/，打包时重写为相对路径 */
const libDir = fileURLToPath(new URL("./lib", import.meta.url));

export default defineConfig({
  // 每个源文件都作为入口：未被类型图引用的内部模块也生成 .d.ts，
  // 与 package.json 中暴露的 "./lib/*" 深引用保持一致
  entry: ["index.ts", "lib/**/*.ts"],
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
