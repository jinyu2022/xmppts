import { describe, expect, it } from "vitest";
import XEP0085 from "../../../lib/plugins/xep0085";
import { ChatState } from "../../../lib/plugins/xep0085/chatState";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0085 插件入口测试：确认特性、转换器、事件与状态发送。
 *
 * @see https://xmpp.org/extensions/xep-0085.html 2.1 §4/§5
 */
describe("XEP0085 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0085(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 ChatState 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0085(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(ChatState);
    expect(XEP0085.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(ChatState.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(ChatState.NS)).toBe(
      ChatState.parseChatStateEl,
    );
    expect(connection.matchersOf("message:chat-state")).toHaveLength(0);
  });

  it("sendChatState 发送只含状态的消息", () => {
    const { connection, plugin } = setup();

    plugin.sendChatState("romeo@montague.lit", "composing");

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    expect(sent.tagName).toBe("message");
    expect(sent.getAttribute("to")).toBe("romeo@montague.lit");
    expect(sent.getAttribute("type")).toBe("chat");
    expect(sent.getElementsByTagName("composing")[0].namespaceURI).toBe(
      ChatState.NS,
    );
  });

  it("sendChatState 支持群聊状态", () => {
    const { connection, plugin } = setup();

    plugin.sendChatState(
      "coven@chat.shakespeare.lit",
      "active",
      "groupchat",
    );

    expect(connection.sent[0].getAttribute("type")).toBe("groupchat");
  });
});
