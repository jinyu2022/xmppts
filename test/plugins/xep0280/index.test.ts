import { describe, it, expect, vi } from "vitest";
import type { Connection } from "../../../lib/connection";
import { JID } from "../../../lib/JID";
import type { Message } from "../../../lib/stanza";
import XEP0280 from "../../../lib/plugins/xep0280";

/**
 * XEP-0280 事件来源校验：碳拷贝包装消息的 from 必须是本账号 bare JID（§11），
 * 否则 MUST 忽略（防 CVE-2017-5589 类伪造）。JID 取自规范 Example 10-13。
 *
 * @see https://xmpp.org/extensions/xep-0280.html 1.0.1 §7 Receiving Messages、§11 Security Considerations
 */

/** 用假连接初始化插件，返回按事件名捕获的 matcher */
function setupMatchers(selfJid = "romeo@montague.example/home") {
  const matchers: Record<string, (message: Message) => boolean> = {};
  const connection = {
    jid: new JID(selfJid),
    once: vi.fn(),
    registerStanzaPlugin: vi.fn(),
    registerEventPlugin: (
      eventName: string,
      option: { matcher: (message: Message) => boolean },
    ) => {
      matchers[eventName] = option.matcher;
    },
    XEP0030: {
      addFeature: vi.fn(),
      getServerFeatures: () => Promise.resolve(new Set<string>()),
    },
  };
  new XEP0280(connection as unknown as Connection).init();
  return matchers;
}

/** 仅含 matcher 所需字段的消息；from 缺失时与真实实例一致回退为自身 full JID */
function fakeMessage(
  from: string | undefined,
  type?: "received" | "sent",
): Message {
  return {
    from: new JID(from ?? "romeo@montague.example/home"),
    carbon: type ? { type } : undefined,
  } as Message;
}

describe("XEP0280 碳拷贝来源校验", () => {
  it("from 为本账号 bare JID 时触发对应事件", () => {
    const matchers = setupMatchers();
    expect(
      matchers["carbon:received"](fakeMessage("romeo@montague.example", "received")),
    ).toBe(true);
    expect(
      matchers["carbon:sent"](fakeMessage("romeo@montague.example", "sent")),
    ).toBe(true);
  });

  it("from 为本账号其它资源的 full JID 时触发", () => {
    const matchers = setupMatchers();
    expect(
      matchers["carbon:received"](fakeMessage("romeo@montague.example/home", "received")),
    ).toBe(true);
  });

  it("from 为其它 JID（伪造）时不触发", () => {
    const matchers = setupMatchers();
    expect(
      matchers["carbon:received"](fakeMessage("tybalt@capulet.example/home", "received")),
    ).toBe(false);
  });

  it("缺失 from 时视为隐式来自自身，触发", () => {
    const matchers = setupMatchers();
    expect(matchers["carbon:sent"](fakeMessage(undefined, "sent"))).toBe(true);
  });

  it("碳类型与事件不符时不触发", () => {
    const matchers = setupMatchers();
    expect(
      matchers["carbon:sent"](fakeMessage("romeo@montague.example", "received")),
    ).toBe(false);
  });

  it("普通消息（无 carbon）不触发", () => {
    const matchers = setupMatchers();
    expect(
      matchers["carbon:received"](fakeMessage("juliet@capulet.example/balcony")),
    ).toBe(false);
  });
});
