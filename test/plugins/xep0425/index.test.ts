import { describe, expect, it } from "vitest";
import XEP0425 from "../../../lib/plugins/xep0425";
import { Moderation } from "../../../lib/plugins/xep0425/moderation";
import type { Connection } from "../../../lib/connection";
import { XMPPError } from "../../../lib/errors";
import { Parser } from "../../../lib/ltx/Parser";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0425 插件入口测试：确认审核转换器与 message:moderated 事件注册、审核请求发送。
 *
 * @see https://xmpp.org/extensions/xep-0425.html 0.3.0 §3 Use Case（Example 4、Example 7）
 */
describe("XEP0425 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0425(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Moderation 并声明 XEP0030/XEP0424 依赖", () => {
    const plugin = new XEP0425(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Moderation);
    expect(XEP0425.dependencies).toEqual(["XEP0030", "XEP0424"]);
  });

  it("init 注册转换器与 message:moderated 事件", () => {
    const { connection } = setup();

    expect(connection.stanzaPlugins.get(Moderation.NS)).toBe(Moderation.parseModeration);
    expect(connection.matchersOf("message:moderated")).toHaveLength(1);
    expect(connection.matchersOf("message:moderated")[0]({ moderated: {} })).toBe(true);
    expect(connection.matchersOf("message:moderated")[0]({})).toBe(false);
  });

  it("moderate 发送带审核元素的 set iq", () => {
    const { connection, plugin } = setup();

    // 规范 Example 4：审核 Example 3 中 stanza-id-1 的消息
    plugin.moderate(
      "room@muc.example.com",
      "stanza-id-1",
      "This message contains inappropriate content for this forum",
    );

    const sent = connection.sent[0];
    expect(sent.tagName).toBe("iq");
    expect(sent.getAttribute("type")).toBe("set");
    expect(
      sent.getElementsByTagNameNS(Moderation.NS, "moderate")[0].getAttribute("id"),
    ).toBe("stanza-id-1");
  });

  it("moderateAsync 在 error 响应时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    // 规范 Example 7：只有版主可审核他人消息
    connection.sendAsyncResult = Parser.parse(
      `<iq type="error" to="room@muc.example.com/macbeth" id="retract-request-1">
        <error type="modify">
          <forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
          <text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">
            Only moderators are allowed to moderate other participants' messages
          </text>
        </error>
      </iq>`,
    );

    await expect(plugin.moderateAsync("room@muc.example.com", "stanza-id-1")).rejects.toBeInstanceOf(
      XMPPError,
    );
  });
});
