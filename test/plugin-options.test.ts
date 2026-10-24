import { describe, expect, it } from "vitest";
import { Connection } from "../lib/connection";

/**
 * `registerPlugin` 的 options 类型约束。
 *
 * 这些用例只验证编译期类型：`@ts-expect-error` 未命中会让 `tsc --noEmit` 失败。
 * 运行时 `registerPlugin` 只登记插件，不会实例化或建立连接。
 */
describe("registerPlugin options 类型", () => {
  it("按插件名推导构造函数第二参数", () => {
    const connection = new Connection("juliet@capulet.lit", "secret");

    connection.registerPlugin("XEP0199", { interval: 60_000 });

    // @ts-expect-error interval 必须是 number
    connection.registerPlugin("XEP0199", { interval: "5" });

    // 空对象：全部可选的配置类型
    connection.registerPlugin("XEP0199", {});

    // @ts-expect-error XEP0030 的构造函数不接受 options（含空对象）
    connection.registerPlugin("XEP0030", {});

    // @ts-expect-error XEP0030 的构造函数不接受 options
    connection.registerPlugin("XEP0030", { foo: 1 });

    // @ts-expect-error XEP0410 的 pingTimeout 必须是 number
    connection.registerPlugin("XEP0410", { pingTimeout: "10s" });

    expect(connection).toBeInstanceOf(Connection);
  });
});
