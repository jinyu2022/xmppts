import { describe, expect, it } from "vitest";
import XEP0060 from "../../../lib/plugins/xep0060";
import { Pubsub } from "../../../lib/plugins/xep0060/pubsub";
import type { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0060 插件入口测试：确认 `pubsub#errors` 附加条件的解析器已注册。
 *
 * @see https://xmpp.org/extensions/xep-0060.html 1.30.0 §11 Error Conditions
 */
describe("XEP0060 插件入口", () => {
  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0060(connection as unknown as Connection);
    plugin.init();
    return connection;
  }

  it("继承 Pubsub，init 注册 pubsub#errors 命名空间的转换器", () => {
    const plugin = new XEP0060(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Pubsub);
    expect(plugin.connection).toBeDefined();
    expect(setup().stanzaPlugins.get(Pubsub.NS.ERRORS)).toBe(Pubsub.parseErrorChildEl);
  });

  describe("parseErrorChildEl（§11.1、§17.2）", () => {
    it("返回附加条件元素名与 feature 属性", () => {
      const el = Parser.parse(
        `<unsupported xmlns="${Pubsub.NS.ERRORS}" feature="retrieve-items"/>`,
      );
      expect(Pubsub.parseErrorChildEl(el)).toEqual({
        pubsub: { condition: "unsupported", feature: "retrieve-items" },
      });
    });

    it("无 feature 属性的条件只给出元素名", () => {
      const el = Parser.parse(`<item-required xmlns="${Pubsub.NS.ERRORS}"/>`);
      expect(Pubsub.parseErrorChildEl(el)).toEqual({
        pubsub: { condition: "item-required", feature: undefined },
      });
    });

    it("命名空间不符时抛错", () => {
      expect(() =>
        Pubsub.parseErrorChildEl(
          Parser.parse(`<unsupported xmlns="${Pubsub.NS.BASE}" feature="retrieve-items"/>`),
        ),
      ).toThrow("不是一个pubsub error元素");
    });
  });
});
