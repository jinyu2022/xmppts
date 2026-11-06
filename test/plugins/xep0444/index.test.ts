import { describe, expect, it } from "vitest";
import XEP0444 from "../../../lib/plugins/xep0444";
import { Reactions } from "../../../lib/plugins/xep0444/reactions";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0444 插件入口测试：确认转换器与反应发送。
 *
 * @see https://xmpp.org/extensions/xep-0444.html 0.2.1 §3.1、§4
 */
describe("XEP0444 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0444(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Reactions 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0444(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Reactions);
    expect(XEP0444.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Reactions.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Reactions.NS)).toBe(
      Reactions.parseReactionsEl,
    );
    expect(connection.matchersOf("message:reactions")).toHaveLength(0);
  });

  it("sendReactions 发送完整反应集合与 store 提示", () => {
    const { connection, plugin } = setup();

    // §3.1 Example 3
    plugin.sendReactions(
      "romeo@capulet.net/orchard",
      "744f6e18-a57a-11e9-a656-4889e7820c76",
      ["👋", "🐢"],
      "chat",
    );

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    const reactions = sent.getElementsByTagName("reactions")[0];
    expect(reactions.getAttribute("id")).toBe(
      "744f6e18-a57a-11e9-a656-4889e7820c76",
    );
    expect(
      Array.from(reactions.getElementsByTagName("reaction")).map(
        (reaction) => reaction.textContent,
      ),
    ).toEqual(["👋", "🐢"]);
    expect(sent.getElementsByTagNameNS(Reactions.HINTS_NS, "store")).toHaveLength(1);
  });

  it("sendReactions 支持群聊并可用空集合移除全部反应", () => {
    const { connection, plugin } = setup();

    plugin.sendReactions(
      "coven@chat.shakespeare.lit",
      "39K7ZYIp",
      [],
      "groupchat",
    );

    const sent = connection.sent[0];
    expect(sent.getAttribute("to")).toBe("coven@chat.shakespeare.lit");
    expect(sent.getAttribute("type")).toBe("groupchat");
    const reactions = sent.getElementsByTagName("reactions")[0];
    expect(reactions.getAttribute("id")).toBe("39K7ZYIp");
    expect(reactions.children).toHaveLength(0);
  });
});
