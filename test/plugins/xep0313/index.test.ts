import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "../../../lib/connection";
import { XMPPError } from "../../../lib/errors";
import { Parser } from "../../../lib/ltx/Parser";
import {
    createTcpConnection,
    getServer,
    negotiate,
    serverRef,
    waitForReceived,
    type MockServer,
} from "../../helpers/mock-transport";

// 将 node:net / node:tls 替换为 Mock Socket，避免真实 TCP/TLS 连接
vi.mock("node:net", async () => {
    const { netMock } = await import("../../helpers/mock-transport");
    return netMock();
});
// TLSSocket 需保留真实导出（传输层用 instanceof 判断 TLS 就绪）
vi.mock("node:tls", async (importOriginal) => {
    const { tlsMock } = await import("../../helpers/mock-transport");
    return tlsMock(importOriginal);
});

/** 已建立连接的引用，供 afterEach 统一断开 */
const active = new Set<Connection>();

const MAM = "urn:xmpp:mam:2";
const MAM_EXTENDED = "urn:xmpp:mam:2#extended";
const MAM_GROUPCHAT_FIELD = "urn:xmpp:mam:2#groupchat-field";

/** 创建注册了 XEP0313 的连接（依赖在 connect() 时自动补齐） */
function createConnection(): Connection {
    const connection = createTcpConnection("juliet@capulet.lit/balcony");
    active.add(connection);
    connection.registerPlugin("XEP0313");
    return connection;
}

/** 完成「连接 → 认证 → 绑定」 */
async function connect() {
    const connection = createConnection();
    const sessionStart = new Promise<void>((resolve) =>
        connection.once("session:start", () => resolve()),
    );
    await connection.connect();
    const server = getServer();
    await negotiate(server, "juliet@capulet.lit/balcony");
    await sessionStart;
    return { connection, server };
}

/** 发送一条归档结果（§4 的结果结构） */
function sendResult(
    server: MockServer,
    queryid: string,
    id: string,
    stamp: string,
    from = "juliet@capulet.lit",
) {
    server.send(`<message xmlns="jabber:client" from="${from}"
        to="juliet@capulet.lit/balcony">
        <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="${id}">
            <forwarded xmlns="urn:xmpp:forward:0">
                <delay xmlns="urn:xmpp:delay" stamp="${stamp}"/>
                <message xmlns="jabber:client"
                         from="romeo@montague.lit/orchard"
                         type="chat">
                    <body>msg ${id}</body>
                </message>
            </forwarded>
        </result>
    </message>`);
}

/** 发送查询收尾的 fin（§4.2.2） */
function sendFin(server: MockServer, iqId: string) {
    server.send(`<iq xmlns="jabber:client" type="result" id="${iqId}">
        <fin xmlns="urn:xmpp:mam:2" complete="true">
            <set xmlns="http://jabber.org/protocol/rsm">
                <first index="0">uid-1</first>
                <last>uid-2</last>
                <count>2</count>
            </set>
        </fin>
    </iq>`);
}

/** 应答 disco#info 请求，声明指定特性 */
function sendDiscoInfo(
    server: MockServer,
    iqId: string,
    features: string[],
) {
    server.send(`<iq xmlns="jabber:client" type="result" from="juliet@capulet.lit" id="${iqId}">
        <query xmlns="http://jabber.org/protocol/disco#info">
            ${features.map((feature) => `<feature var="${feature}"/>`).join("")}
        </query>
    </iq>`);
}

/** 取出客户端发出的查询 IQ 及其 queryid */
async function takeQueryIq(server: MockServer) {
    const iq = Parser.parse(await waitForReceived(server, "urn:xmpp:mam:2"));
    const query = iq.querySelector(":scope > query")!;
    return { iq, queryid: query.getAttribute("queryid")! };
}

/**
 * XEP-0313 插件入口集成测试：Mock Socket 驱动「连接 → 认证 → 绑定」，
 * 验证查询、结果收集（含来源校验）、三种消费形态与错误处理。
 *
 * @see https://xmpp.org/extensions/xep-0313.html 1.1.3 §4（查询与结果）、§9.2（来源校验）
 */
describe("XEP0313 插件入口", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serverRef.current = null;
    });

    afterEach(() => {
        for (const connection of active) {
            connection.transport?.disconnect();
        }
        active.clear();
    });

    it("queryArchive 收集整页结果并解析 forwarded/delay", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            with: "romeo@montague.lit",
            page: { max: 2 },
        });
        const { iq, queryid } = await takeQueryIq(server);

        sendResult(server, queryid, "uid-1", "2010-07-10T23:08:25Z");
        sendResult(server, queryid, "uid-2", "2010-07-10T23:09:32Z");
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(page.results.map((item) => item.id)).toEqual(["uid-1", "uid-2"]);
        expect(page.results[0].message.body).toBe("msg uid-1");
        expect(page.results[0].stamp?.getTime()).toBe(
            Date.UTC(2010, 6, 10, 23, 8, 25),
        );
        expect(page.fin.complete).toBe(true);
        expect(page.fin.rsm?.last).toBe("uid-2");
    });

    it("忽略来源与归档地址不符的结果（§9.2）", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 2 },
        });
        const { iq, queryid } = await takeQueryIq(server);

        sendResult(
            server,
            queryid,
            "forged",
            "2010-07-10T23:08:25Z",
            "mallory@evil.lit",
        );
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(page.results).toHaveLength(0);
    });

    it("忽略 queryid 不匹配的结果", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 2 },
        });
        const { iq } = await takeQueryIq(server);

        sendResult(server, "other-query", "uid-1", "2010-07-10T23:08:25Z");
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(page.results).toHaveLength(0);
    });

    it("跳过命名空间不符的同名子元素", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 1 },
        });
        const { iq, queryid } = await takeQueryIq(server);

        server.send(`<message xmlns="jabber:client" from="juliet@capulet.lit"
            to="juliet@capulet.lit/balcony">
            <result xmlns="urn:example:other" id="other"/>
            <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="uid-1">
                <forwarded xmlns="urn:xmpp:forward:0">
                    <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                    <message xmlns="jabber:client"
                             from="romeo@montague.lit/orchard"
                             type="chat">
                        <body>msg uid-1</body>
                    </message>
                </forwarded>
            </result>
        </message>`);
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(page.results.map((item) => item.id)).toEqual(["uid-1"]);
    });

    it("并发查询各自只收集自己的结果", async () => {
        const { connection, server } = await connect();

        const first = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 1 },
        });
        const firstIq = Parser.parse(
            await waitForReceived(server, "urn:xmpp:mam:2"),
        );
        const firstQueryid = firstIq
            .querySelector(":scope > query")!
            .getAttribute("queryid")!;

        const second = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 1 },
        });
        const secondIq = Parser.parse(
            await waitForReceived(server, "urn:xmpp:mam:2"),
        );
        const secondQueryid = secondIq
            .querySelector(":scope > query")!
            .getAttribute("queryid")!;

        // 交错推送时两个监听器同时存在
        sendResult(server, firstQueryid, "uid-a", "2010-07-10T23:08:25Z");
        sendResult(server, secondQueryid, "uid-b", "2010-07-10T23:09:32Z");
        sendFin(server, firstIq.getAttribute("id")!);
        sendFin(server, secondIq.getAttribute("id")!);

        const [pageA, pageB] = await Promise.all([first, second]);
        expect(pageA.results.map((item) => item.id)).toEqual(["uid-a"]);
        expect(pageB.results.map((item) => item.id)).toEqual(["uid-b"]);
    });

    it("错误 IQ 让查询以 XMPPError 拒绝", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive("juliet@capulet.lit", {
            page: { max: 2 },
        });
        const { iq } = await takeQueryIq(server);

        server.send(`<iq xmlns="jabber:client" type="error" id="${iq.getAttribute("id")}">
            <error type="cancel">
                <item-not-found xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
            </error>
        </iq>`);

        await expect(pending).rejects.toBeInstanceOf(XMPPError);
    });

    it("onResult 逐条回调，异常不影响整页结果", async () => {
        const { connection, server } = await connect();
        const seen: string[] = [];
        const pending = connection.XEP0313!.queryArchive(
            "juliet@capulet.lit",
            { page: { max: 2 } },
            (item) => {
                seen.push(item.id);
                throw new Error("本地写入失败");
            },
        );
        const { iq, queryid } = await takeQueryIq(server);

        sendResult(server, queryid, "uid-1", "2010-07-10T23:08:25Z");
        sendResult(server, queryid, "uid-2", "2010-07-10T23:09:32Z");
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(seen).toEqual(["uid-1", "uid-2"]);
        expect(page.results).toHaveLength(2);
    });

    it("iterateArchive 按推送顺序逐条产出", async () => {
        const { connection, server } = await connect();
        const ids: string[] = [];
        // 生成器在首次 next() 时才发出查询，消费与应答必须并行推进
        const consuming = (async () => {
            for await (const item of connection.XEP0313!.iterateArchive(
                "juliet@capulet.lit",
                { page: { max: 2 } },
            )) {
                ids.push(item.id);
            }
        })();
        const { iq, queryid } = await takeQueryIq(server);

        sendResult(server, queryid, "uid-1", "2010-07-10T23:08:25Z");
        sendResult(server, queryid, "uid-2", "2010-07-10T23:09:32Z");
        sendFin(server, iq.getAttribute("id")!);

        await consuming;
        expect(ids).toEqual(["uid-1", "uid-2"]);
    });

    it("未声明 #extended 时拒绝使用 beforeId，且不发出查询", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive(
            "juliet@capulet.lit",
            { beforeId: "uid-1" },
        );
        const disco = Parser.parse(
            await waitForReceived(server, 'to="juliet@capulet.lit"'),
        );
        sendDiscoInfo(server, disco.getAttribute("id")!, [MAM]);

        await expect(pending).rejects.toThrow(MAM_EXTENDED);
        expect(server.received.some((xml) => xml.includes("queryid="))).toBe(
            false,
        );
    });

    it("声明 #extended 后 beforeId 查询照常发出", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive(
            "juliet@capulet.lit",
            {
                beforeId: "uid-1",
                page: { max: 1 },
            },
        );
        const disco = Parser.parse(
            await waitForReceived(server, 'to="juliet@capulet.lit"'),
        );
        sendDiscoInfo(server, disco.getAttribute("id")!, [
            MAM,
            MAM_EXTENDED,
        ]);

        const { iq, queryid } = await takeQueryIq(server);
        sendResult(server, queryid, "uid-1", "2010-07-10T23:08:25Z");
        sendFin(server, iq.getAttribute("id")!);

        const page = await pending;
        expect(page.results.map((item) => item.id)).toEqual(["uid-1"]);
    });

    it("未声明 #groupchat-field 时拒绝 includeGroupchat", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryArchive(
            "juliet@capulet.lit",
            { includeGroupchat: false },
        );
        const disco = Parser.parse(
            await waitForReceived(server, 'to="juliet@capulet.lit"'),
        );
        sendDiscoInfo(server, disco.getAttribute("id")!, [MAM, MAM_EXTENDED]);

        await expect(pending).rejects.toThrow(MAM_GROUPCHAT_FIELD);
    });

    it("queryMetadata 解析归档首尾消息", async () => {
        const { connection, server } = await connect();
        const pending = connection.XEP0313!.queryMetadata();
        const iq = Parser.parse(await waitForReceived(server, "metadata"));

        server.send(`<iq xmlns="jabber:client" type="result" id="${iq.getAttribute("id")}">
            <metadata xmlns="urn:xmpp:mam:2">
                <start id="YWxwaGEg" timestamp="2008-08-22T21:09:04Z"/>
                <end id="b21lZ2Eg" timestamp="2020-04-20T14:34:21Z"/>
            </metadata>
        </iq>`);

        const metadata = await pending;
        expect(metadata.start?.id).toBe("YWxwaGEg");
        expect(metadata.end?.id).toBe("b21lZ2Eg");
    });

    it("queryFormFields 解析服务端支持的查询字段（§4.1.5）", async () => {
        const { connection, server } = await connect();
        const pending =
            connection.XEP0313!.queryFormFields("juliet@capulet.lit");
        const iq = Parser.parse(
            await waitForReceived(server, "urn:xmpp:mam:2"),
        );

        server.send(`<iq xmlns="jabber:client" type="result" id="${iq.getAttribute("id")}">
            <query xmlns="urn:xmpp:mam:2">
                <x xmlns="jabber:x:data" type="form">
                    <field var="FORM_TYPE" type="hidden">
                        <value>urn:xmpp:mam:2</value>
                    </field>
                    <field var="with" type="jid-single"/>
                </x>
            </query>
        </iq>`);

        const form = await pending;
        expect(form.type).toBe("form");
        expect(form.fields.map((field) => field.var)).toEqual([
            "FORM_TYPE",
            "with",
        ]);
    });
});
