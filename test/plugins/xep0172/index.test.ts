import { describe, expect, it } from "vitest";
import XEP0172 from "../../../lib/plugins/xep0172";
import { Nickname } from "../../../lib/plugins/xep0172/nickname";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0172 插件入口测试：确认昵称转换器与 pep:nickname 事件注册、检索与缓存。
 *
 * @see https://xmpp.org/extensions/xep-0172.html 1.1 §3 Format（Example 1）、§4.2 Message Exchange（Example 5）
 */
describe("XEP0172 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0172(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Nickname 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0172(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Nickname);
    expect(XEP0172.dependencies).toEqual(["XEP0030"]);
  });

  it("init 注册转换器与 pep:nickname 事件", () => {
    const { connection } = setup();

    expect(connection.stanzaPlugins.get(XEP0172.NS)).toBe(XEP0172.parseNickEl);
    expect(connection.matchersOf("pep:nickname")).toHaveLength(1);
    expect(
      connection.matchersOf("pep:nickname")[0]({ event: { node: XEP0172.NS } }),
    ).toBe(true);
    expect(connection.matchersOf("pep:nickname")[0]({ event: { node: "other" } })).toBe(false);
  });

  it("retrieveNick 返回响应中的昵称，error 时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    // 规范 Example 1：<nick xmlns='http://jabber.org/protocol/nick'>Ishmael</nick>
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result" from="narrator@moby-dick.lit/pda"><nick xmlns="${XEP0172.NS}">Ishmael</nick></iq>`,
    );
    await expect(plugin.retrieveNick("narrator@moby-dick.lit")).resolves.toBe("Ishmael");

    connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
    await expect(plugin.retrieveNick("narrator@moby-dick.lit")).rejects.toBeInstanceOf(
      XMPPError,
    );
  });

  it("getSelfNick 缓存结果且失败时 resolve undefined", async () => {
    const { connection, plugin } = setup();
    let calls = 0;
    connection.sendAsync = () => {
      calls += 1;
      // 规范 Example 5：PEP 节点上的更新昵称
      return Promise.resolve(
        Parser.parse(`<iq type="result"><nick xmlns="${XEP0172.NS}">CallMeIshmael</nick></iq>`),
      );
    };

    await expect(plugin.getSelfNick()).resolves.toBe("CallMeIshmael");
    await expect(plugin.getSelfNick()).resolves.toBe("CallMeIshmael");
    expect(calls).toBe(1);

    connection.sendAsync = () => {
      throw new Error("断线");
    };
    const failing = new XEP0172(new FakeConnection() as unknown as Connection);
    await expect(failing.getSelfNick()).resolves.toBeUndefined();
  });
});
