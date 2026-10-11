import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import XEP0077 from "../../../lib/plugins/xep0077";
import { Register } from "../../../lib/plugins/xep0077/register";
import { Parser } from "../../../lib/ltx/Parser";
import { XMPPError } from "../../../lib/errors";
import type { TLSSocket } from "node:tls";

/**
 * XEP-0077 插件入口测试：桩住静态建连，验证流头、注册表单查询与提交。
 * register.ts 的 Register 能力由 register.test.ts 覆盖。
 *
 * @see https://xmpp.org/extensions/xep-0077.html 2.4 §3.1 Entity Registers with a Host（Example 4~6）
 *      、§8 Stream Feature（Example 26）
 */

/** 假 socket：只实现 setListener 用到的 write/事件方法 */
class FakeSocket extends EventEmitter {
  readonly written: string[] = [];
  write(data: string): void {
    this.written.push(data);
  }
}

const REGISTER_FEATURES = `<stream:features xmlns:stream="http://etherx.jabber.org/streams">
  <register xmlns="http://jabber.org/features/iq-register"/>
</stream:features>`;

async function connectPlugin() {
  const socket = new FakeSocket();
  vi.spyOn(Register, "createSocket").mockResolvedValue(
    socket as unknown as TLSSocket,
  );
  const plugin = new XEP0077();
  await plugin.connectSocket("shakespeare.lit", "ws");
  socket.emit("connect");
  return { plugin, socket };
}

describe("XEP0077 插件入口", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("继承 Register 且 init 为空操作", () => {
    const plugin = new XEP0077();
    expect(plugin).toBeInstanceOf(Register);
    expect(() => plugin.init()).not.toThrow();
  });

  it("connectSocket 在连接建立后写出 framing 流头", async () => {
    const { socket } = await connectPlugin();
    expect(socket.written[0]).toContain("<open to=\"shakespeare.lit\"");
    expect(socket.written[0]).toContain('xmlns="urn:ietf:params:xml:ns:xmpp-framing"');
  });

  it("服务器宣告注册能力后查询表单，并用响应兑现 getRegistrationForm", async () => {
    const { plugin, socket } = await connectPlugin();

    socket.emit("data", REGISTER_FEATURES);
    await vi.waitFor(() =>
      expect(
        socket.written.some((x) => x.includes("<query") && x.includes(XEP0077.NS)),
      ).toBe(true),
    );

    const query = Parser.parse(
      socket.written.find((x) => x.includes("<query") && x.includes(XEP0077.NS))!,
    );
    const formPromise = plugin.getRegistrationForm();
    // 规范 Example 9：服务端返回 Data Form（此处取其部分字段）
    socket.emit(
      "data",
      `<iq id="${query.getAttribute("id")}" type="result">
        <query xmlns="${XEP0077.NS}">
          <x xmlns="jabber:x:data" type="form">
            <title>Contest Registration</title>
            <instructions>Please provide the following information to sign up.</instructions>
            <field type="hidden" var="FORM_TYPE"><value>jabber:iq:register</value></field>
            <field type="text-single" label="Given Name" var="first"><required/></field>
            <field type="text-single" label="Family Name" var="last"><required/></field>
          </x>
        </query>
      </iq>`,
    );

    const form = await formPromise;
    expect(form?.type).toBe("form");
    expect(form?.fields.map((f) => f.var)).toContain("first");
  });

  it("register 提交成功返回 true，error 响应抛 XMPPError", async () => {
    const { plugin, socket } = await connectPlugin();

    const ok = plugin.register("bill", "Calliope");
    await vi.waitFor(() => expect(socket.written.some((x) => x.includes("<iq"))).toBe(true));
    const submit = Parser.parse(socket.written.find((x) => x.includes("<iq"))!);
    // 规范 Example 5：注册成功
    socket.emit("data", `<iq id="${submit.getAttribute("id")}" type="result"/>`);
    await expect(ok).resolves.toBe(true);

    const failed = plugin.register("bill", "Calliope");
    await vi.waitFor(() => expect(socket.written.filter((x) => x.includes("<iq")).length).toBe(2));
    const second = Parser.parse(socket.written.filter((x) => x.includes("<iq"))[1]);
    // 规范 Example 6：用户名冲突
    socket.emit(
      "data",
      `<iq id="${second.getAttribute("id")}" type="error">
        <query xmlns="${XEP0077.NS}">
          <username>bill</username>
          <password>m1cro$oft</password>
          <email>billg@bigcompany.com</email>
        </query>
        <error code="409" type="cancel">
          <conflict xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
        </error>
      </iq>`,
    );
    const error = await failed.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(XMPPError);
    expect((error as XMPPError).condition).toBe("conflict");
  });
});
