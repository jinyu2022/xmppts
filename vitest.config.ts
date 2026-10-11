import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** 测试直接引用 lib/ 源码，需同步 `@` 别名的解析规则 */
const libDir = fileURLToPath(new URL("./lib", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": libDir,
    },
  },
  test: {
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    globals: true,
    environment: "node",
  },
});
