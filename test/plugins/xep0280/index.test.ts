import { describe, it, expect, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { JID } from "../../../lib/JID";
import type { Message } from "../../../lib/stanza";
import { Parser } from "../../../lib/ltx/Parser";
import { XEP0030 } from "../../../lib/plugins/xep0030";
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

  it("Example 10：真实连接解析 carbon 后派发 carbon:received", () => {
    const connection = new Connection("romeo@montague.example/home", "test123");
    // 插件 init 依赖 XEP0030.addFeature，这里挂上真实实例而不触发会话事件
    const disco = new XEP0030(connection);
    disco.init();
    Object.assign(connection, { XEP0030: disco });
    new XEP0280(connection).init();

    const received: Message[] = [];
    connection.on("carbon:received", (message) => received.push(message));
    // 绕过 socket 与 XML 流解析，直接把已解析的 stanza 交给连接层接收处理
    const sink = connection._createSink();
    sink.onStanza(
      Parser.parse(`
        <message xmlns="jabber:client" from="romeo@montague.example" to="romeo@montague.example/home" type="chat">
          <received xmlns="urn:xmpp:carbons:2">
            <forwarded xmlns="urn:xmpp:forward:0">
              <message xmlns="jabber:client" from="juliet@capulet.example/balcony" to="romeo@montague.example/garden" type="chat">
                <body>What man art thou that, thus bescreen'd in night, so stumblest on my counsel?</body>
                <thread>0e3141cd80894871a68e6fe6b1ec56fa</thread>
              </message>
            </forwarded>
          </received>
        </message>
      `),
    );

    // 外层 from 为本账号 bare JID，经转换层挂上 carbon 后通过 §11 来源校验
    expect(received).toHaveLength(1);
    expect(received[0].carbon?.type).toBe("received");
    expect(received[0].from.bare).toBe("romeo@montague.example");
  });
});
