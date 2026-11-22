import { describe, expect, it } from "vitest";
import XEP0372 from "../../../lib/plugins/xep0372";
import { Reference } from "../../../lib/plugins/xep0372/reference";
import XEP0030 from "../../../lib/plugins/xep0030";
import { Connection } from "../../../lib/connection";
import { Parser } from "../../../lib/ltx/Parser";
import type { Message } from "../../../lib/stanza";
import { Status, type TransportSocket } from "../../../lib/transport/typing";
import { FakeConnection } from "../../helpers/fake-connection";

/**
 * XEP-0372 插件入口测试：确认特性、转换器与发送。
 *
 * @see https://xmpp.org/extensions/xep-0372.html 0.5.0 §3
 */
describe("XEP0372 插件入口", () => {
  /** §3.2 的消息正文 */
  const BODY =
    "But, soft! what light through yonder window breaks? It is the east, and Juliet is the sun.";
  /** §3.3 的 data 引用 URI */
  const FDP_URI =
    "xmpp:fdp.shakespeare.lit?;node=fdp/submitted/stan.isode.net/accidentreport;item=ndina872be";

  function setup() {
    const connection = new FakeConnection();
    const plugin = new XEP0372(connection as unknown as Connection);
    plugin.init();
    return { connection, plugin };
  }

  it("继承 Reference 并声明 XEP0030 依赖", () => {
    const plugin = new XEP0372(new FakeConnection() as unknown as Connection);
    expect(plugin).toBeInstanceOf(Reference);
    expect(XEP0372.dependencies).toEqual(["XEP0030"]);
  });

  it("init 宣告特性与转换器，不注册专用事件", () => {
    const { connection } = setup();

    expect(connection.features.has(Reference.NS)).toBe(true);
    expect(connection.stanzaPlugins.get(Reference.NS)).toBe(
      Reference.parseReferenceEl,
    );
    expect(connection.matchersOf("message:reference")).toHaveLength(0);
  });

  it("sendReferences 发送带引用的消息", () => {
    const { connection, plugin } = setup();

    // 参数取自 §3.2 的 mention 示例
    plugin.sendReferences(
      "balcony@channels.shakespeare.lit",
      BODY,
      [
        {
          type: "mention",
          uri: "xmpp:juliet@capulet.lit",
          begin: 72,
          end: 78,
        },
      ],
      "groupchat",
    );

    expect(connection.sent).toHaveLength(1);
    const sent = connection.sent[0];
    // 生成的消息不带 id 与 from，其余与 §3.2 示例一致
    expect(sent.getAttribute("to")).toBe(
      "balcony@channels.shakespeare.lit",
    );
    expect(sent.getAttribute("type")).toBe("groupchat");
    expect(sent.getElementsByTagName("body")[0].textContent).toBe(BODY);
    const references = sent.getElementsByTagName("reference");
    expect(references).toHaveLength(1);
    expect(references[0].namespaceURI).toBe(Reference.NS);
    expect(references[0].getAttribute("type")).toBe("mention");
    expect(references[0].getAttribute("uri")).toBe(
      "xmpp:juliet@capulet.lit",
    );
    expect(references[0].getAttribute("begin")).toBe("72");
    expect(references[0].getAttribute("end")).toBe("78");
  });

  it("接收带 mention 与 data 引用的消息，references 合并为数组", () => {
    const connection = new Connection("juliet@capulet.lit/laptop", "secret");
    // XEP0372 依赖 XEP0030 宣告特性，先挂上依赖实例（插件属性由 as const 表推导为只读）
    Object.assign(connection, { XEP0030: new XEP0030(connection) });
    const sink = connection._createSink();
    // 接收路径只访问 transport.status，onBound 另需 transport.jid
    connection.transport = {
      status: Status.BINDED,
      jid: connection.jid,
    } as unknown as TransportSocket;
    sink.onBound(true);
    new XEP0372(connection).init();

    const received: Message[] = [];
    connection.on("message", (message) => {
      received.push(message);
    });

    // §3.2 mention + §3.3 data，规范无单条消息携带两个引用的示例
    sink.onStanza(
      Parser.parse(
        `<message type="groupchat" id="sotehu-bthbtp32h3" to="balcony@channels.shakespeare.lit">
           <body>${BODY}</body>
           <reference xmlns="urn:xmpp:reference:0" begin="72" end="78" type="mention" uri="xmpp:juliet@capulet.lit"/>
           <reference xmlns="urn:xmpp:reference:0" type="data" uri="${FDP_URI}"/>
         </message>`,
      ),
    );

    expect(received).toHaveLength(1);
    expect(received[0].references).toEqual([
      {
        type: "mention",
        uri: "xmpp:juliet@capulet.lit",
        begin: 72,
        end: 78,
      },
      { type: "data", uri: FDP_URI },
    ]);
  });
});
