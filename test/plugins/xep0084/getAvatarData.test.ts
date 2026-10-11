import { describe, it, expect } from "vitest";
import type { Connection } from "../../../lib/connection";
import type { XMPPElement } from "../../../lib/ltx/Element";
import { Parser } from "../../../lib/ltx/Parser";
import XEP0084 from "../../../lib/plugins/xep0084/index";

/**
 * XEP-0084 getAvatarData：对方无头像时的行为。
 * @see https://xmpp.org/extensions/xep-0084.html#retrieve
 *
 * 按规范，用户未发布头像时服务器返回空的 <items/>（无 <metadata/> 子元素）；
 * 约定：元素不存在返回 undefined，元素存在但为空返回 null，且不抛错。
 */

/** 无 metadata 子元素的响应（对方未发布头像） */
const EMPTY_ITEMS_RES = `
  <iq type="result">
    <pubsub xmlns="http://jabber.org/protocol/pubsub">
      <items node="urn:xmpp:avatar:metadata"/>
    </pubsub>
  </iq>`;

/** 存在 <metadata/> 但没有 <info/> 子元素的响应 */
const EMPTY_METADATA_RES = `
  <iq type="result">
    <pubsub xmlns="http://jabber.org/protocol/pubsub">
      <items node="urn:xmpp:avatar:metadata">
        <item><metadata xmlns="urn:xmpp:avatar:metadata"/></item>
      </items>
    </pubsub>
  </iq>`;

/** 用一组预设响应依次返回的假连接 */
function createPlugin(responses: XMPPElement[]) {
  const queue = [...responses];
  const connection = {
    sendAsync: () => Promise.resolve(queue.shift()!),
  };
  return new XEP0084(connection as unknown as Connection);
}

describe("XEP0084.getAvatarData 无头像场景", () => {
  it("Example 3+7：先取元数据再按 ItemID 取头像数据", async () => {
    const ID = "111f4b3c50d7b0df729d299bc6f8e9ef9066971f";
    const plugin = createPlugin([
      Parser.parse(`
        <iq type="result">
          <pubsub xmlns="http://jabber.org/protocol/pubsub">
            <items node="urn:xmpp:avatar:metadata">
              <item id="${ID}">
                <metadata xmlns="urn:xmpp:avatar:metadata">
                  <info bytes="12345" id="${ID}" height="64" type="image/png" width="64"/>
                </metadata>
              </item>
            </items>
          </pubsub>
        </iq>`),
      Parser.parse(`
        <iq type="result">
          <pubsub xmlns="http://jabber.org/protocol/pubsub">
            <items node="urn:xmpp:avatar:data">
              <item id="${ID}">
                <data xmlns="urn:xmpp:avatar:data">qANQR1DBwU4DX7jmYZnncm</data>
              </item>
            </items>
          </pubsub>
        </iq>`),
    ]);
    const res = await plugin.getAvatarData("juliet@capulet.lit");
    expect(res?.id).toBe(ID);
    expect(res?.type).toBe("image/png");
    expect(res?.data).toBe("qANQR1DBwU4DX7jmYZnncm");
  });

  it("无 metadata 参数时，空 items 返回 undefined（元素不存在）", async () => {
    const plugin = createPlugin([Parser.parse(EMPTY_ITEMS_RES)]);
    const res = await plugin.getAvatarData("romeo@example.net");
    expect(res).toBeUndefined();
  });

  it("已传 metadata 时，空 items 的 data 为 undefined", async () => {
    const plugin = createPlugin([Parser.parse(EMPTY_ITEMS_RES)]);
    const res = await plugin.getAvatarData("romeo@example.net", {
      id: "00",
      type: "image/png",
      bytes: 0,
    });
    expect(res?.data).toBeUndefined();
  });

  it("空 <metadata/>（无 info）返回 null（元素存在但为空）", async () => {
    const plugin = createPlugin([Parser.parse(EMPTY_METADATA_RES)]);
    const res = await plugin.getAvatarData("romeo@example.net");
    expect(res).toBeNull();
  });
});
