import { describe, expect, it } from "vitest";
import XEP0004 from "../../../lib/plugins/xep0004";
import { Form } from "../../../lib/plugins/xep0004/form";
import type { Connection } from "../../../lib/connection";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0004 插件入口测试：确认注册入口就位，实现能力由 form.test.ts 覆盖。
 *
 * @see https://xmpp.org/extensions/xep-0004.html 2.13.2 §3 Protocol
 */
describe("XEP0004 插件入口", () => {
  it("继承 Form、无依赖且 init 为空操作", () => {
    const plugin = new XEP0004(new FakeConnection() as unknown as Connection);

    expect(plugin).toBeInstanceOf(Form);
    expect(XEP0004.dependencies).toEqual([]);
    expect(() => plugin.init()).not.toThrow();
  });

  it("入口类可访问表单构造能力", () => {
    expect(typeof XEP0004.createFormEl).toBe("function");
    expect(XEP0004.NS).toBe("jabber:x:data");
  });
});
