import { describe, expect, it } from "vitest";
import { Client, XEP0077 } from "../lib/main";
import { Connection } from "../lib/connection";
import { Register } from "../lib/plugins/xep0077/register";

/**
 * 包入口测试：确认对外只导出 Client 与独立连接的 XEP0077。
 */
describe("main 入口", () => {
  it("导出 Client 与 XEP0077", () => {
    expect(typeof Client).toBe("function");
    expect(typeof XEP0077).toBe("function");
  });

  it("Client 可直接实例化并继承 Connection", () => {
    const client = new Client("juliet@capulet.lit/balcony", "secret");
    expect(client).toBeInstanceOf(Connection);
  });

  it("XEP0077 可直接实例化并继承 Register", () => {
    expect(new XEP0077()).toBeInstanceOf(Register);
  });
});
