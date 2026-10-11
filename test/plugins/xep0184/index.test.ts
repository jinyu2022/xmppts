import { describe, expect, it } from "vitest";
import XEP0184 from "../../../lib/plugins/xep0184";
import { MessageReceipts } from "../../../lib/plugins/xep0184/messageReceipts";
import type { Connection } from "../../../lib/connection";
import { JID } from "../../../lib/JID";
import { Message } from "../../../lib/stanza";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0184 插件入口测试：确认回执转换器、发送拦截与自动回执。
 *
 * @see https://xmpp.org/extensions/xep-0184.html 1.2 §3 Message Delivery Receipts（Example 3、Example 4）
 */

/** 规范 Example 3/4 的发送方（完整 JID）与消息 id */
const NORTHUMBERLAND = "northumberland@shakespeare.lit/westminster";
const MESSAGE_ID = "richard2-4.1.247";

describe("XEP0184 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0184(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 MessageReceipts 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0184(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(MessageReceipts);
    expect(XEP0184.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性并注册回执转换器", () => {
    const connection = setup();

    expect(connection.features.has(MessageReceipts.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(MessageReceipts.NS)).toBe(XEP0184.parseReceipts);
  });

  it("发送带 body 的消息自动附加回执请求，无 body 的不附加", () => {
    const connection = setup();
    const to = "kingrichard@royalty.england.lit/throne";

    const withBody = Message.createMessage(to, "My lord, the Duke of Buckingham.");
    connection.pipeline.run("send", { stanza: withBody });
    expect(withBody.getElementsByTagNameNS(MessageReceipts.NS, "request")).toHaveLength(1);

    const withoutBody = Message.createMessage(to);
    connection.pipeline.run("send", { stanza: withoutBody });
    expect(withoutBody.getElementsByTagNameNS(MessageReceipts.NS, "request")).toHaveLength(
      0,
    );
  });

  it("收到普通回执请求时自动回复 received", () => {
    const connection = setup();

    // 规范 Example 3：来自未验证资源的回执请求
    connection.emit("message", {
      receipts: { type: "request" },
      type: "chat",
      id: MESSAGE_ID,
      from: new JID(NORTHUMBERLAND),
    });

    expect(connection.sent).toHaveLength(1);
    const receipt = connection.sent[0];
    // 规范 Example 4：回执回复给原始发送者的完整 JID
    expect(receipt.getAttribute("to")).toBe(NORTHUMBERLAND);
    const received = receipt.getElementsByTagNameNS(MessageReceipts.NS, "received")[0];
    expect(received.getAttribute("id")).toBe(MESSAGE_ID);
  });

  it("groupchat 与 error 类型的回执请求不自动回复", () => {
    const connection = setup();

    connection.emit("message", {
      receipts: { type: "request" },
      type: "groupchat",
      id: "m1",
      from: new JID("coven@chat.shakespeare.lit/thirdwitch"),
    });
    connection.emit("message", {
      receipts: { type: "request" },
      type: "error",
      id: "m2",
      from: new JID("kingrichard@royalty.england.lit/throne"),
    });

    expect(connection.sent).toHaveLength(0);
  });
});
