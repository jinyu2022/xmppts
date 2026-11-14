import { describe, expect, it } from "vitest";
import XEP0184 from "../../../lib/plugins/xep0184";
import { MessageReceipts } from "../../../lib/plugins/xep0184/messageReceipts";
import type { Connection } from "../../../lib/connection";
import { JID } from "../../../lib/JID";
import { Message } from "../../../lib/stanza";
import { XMPPElement } from "../../../lib/ltx/Element";
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

  it("只按直接子元素判断 body，转发消息内层 body 不触发回执请求", () => {
    const connection = setup();
    const to = "kingrichard@royalty.england.lit/throne";

    // 外层没有 body，body 只存在于 <forwarded><message> 里
    const outer = Message.createMessage(to);
    const forwarded = XMPPElement.createElementNS(
      "urn:xmpp:forward:0",
      "forwarded",
    );
    forwarded.appendChild(Message.createMessage(to, "inner body"));
    outer.appendChild(forwarded);

    connection.pipeline.run("send", { stanza: outer });
    expect(
      outer.getElementsByTagNameNS(MessageReceipts.NS, "request"),
    ).toHaveLength(0);
  });

  it("携带 received 的 ack 消息不再追加回执请求", () => {
    const connection = setup();
    const to = "kingrichard@royalty.england.lit/throne";

    // §5.4：应答消息本身带正文与 <received/>，不能再被追加 request
    const ack = Message.createMessage(to, "Received");
    ack.appendChild(XEP0184.createReceiptsEl("received", "message1"));

    connection.pipeline.run("send", { stanza: ack });
    expect(
      ack.getElementsByTagNameNS(MessageReceipts.NS, "request"),
    ).toHaveLength(0);
  });

  it("只按直接子元素判断 received，转发消息内层 received 不阻止请求", () => {
    const connection = setup();
    const to = "kingrichard@royalty.england.lit/throne";

    // 外层是新消息，<received/> 只存在于 <forwarded><message> 里
    const outer = Message.createMessage(to, "new message");
    const forwarded = XMPPElement.createElementNS(
      "urn:xmpp:forward:0",
      "forwarded",
    );
    const inner = Message.createMessage(to, "old ack");
    inner.appendChild(XEP0184.createReceiptsEl("received", "message0"));
    forwarded.appendChild(inner);
    outer.appendChild(forwarded);

    connection.pipeline.run("send", { stanza: outer });
    expect(
      outer.getElementsByTagNameNS(MessageReceipts.NS, "request"),
    ).toHaveLength(1);
  });

  it("配置 autoRequest: false 时不再附加回执请求", () => {
    const connection = new FakeConnection();
    const plugin = new XEP0184(connection as unknown as Connection, {
      autoRequest: false,
    });
    plugin.init();

    const message = Message.createMessage(
      "kingrichard@royalty.england.lit/throne",
      "My lord, the Duke of Buckingham.",
    );
    connection.pipeline.run("send", { stanza: message });

    expect(
      message.getElementsByTagNameNS(MessageReceipts.NS, "request"),
    ).toHaveLength(0);
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
