import { describe, expect, it } from "vitest";
import XEP0486 from "../../../lib/plugins/xep0486";
import { MUCAvatars } from "../../../lib/plugins/xep0486/MUCAvatars";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0486 插件入口测试：确认 MUCAvatars 继承与 setAvatar/getAvatar 的响应处理。
 *
 * @see https://xmpp.org/extensions/xep-0486.html 0.1.0 §3.4 User Retrieves the vCard（Example 12）
 */
describe("XEP0486 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0486(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 MUCAvatars 且 init 为空操作", () => {
    const { plugin } = setup();
    expect(plugin).toBeInstanceOf(MUCAvatars);
    expect(() => plugin.init()).not.toThrow();
  });

  it("setAvatar 成功返回响应，error 时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    const room = "garden@chat.shakespeare.example.org";
    await expect(plugin.setAvatar(room)).resolves.toBeDefined();

    connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
    await expect(plugin.setAvatar(room)).rejects.toBeInstanceOf(XMPPError);
  });

  it("getAvatar 解析 vCard 中的头像，error 时抛 XMPPError", async () => {
    const { connection, plugin } = setup();
    const room = "garden@chat.shakespeare.example.org";
    // 规范 Example 12：房间返回的 vCard-temp（SVG 头像）
    connection.sendAsyncResult = Parser.parse(
      `<iq type="result" id="uD10h" to="juliet@capulet.example.com/balcony" from="${room}">
        <vCard xmlns="vcard-temp">
          <PHOTO>
            <TYPE>image/svg+xml</TYPE>
            <BINVAL>PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+CiA8cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9InJlZCIvPgo8L3N2Zz4K</BINVAL>
          </PHOTO>
        </vCard>
      </iq>`,
    );

    await expect(plugin.getAvatar(room)).resolves.toEqual({
      type: "image/svg+xml",
      binval:
        "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+CiA8cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9InJlZCIvPgo8L3N2Zz4K",
    });

    connection.sendAsyncResult = Parser.parse(`<iq type="error"/>`);
    await expect(plugin.getAvatar(room)).rejects.toBeInstanceOf(XMPPError);
  });
});
