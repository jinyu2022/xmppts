import { describe, it, expect, vi } from "vitest";
import { StanzaBase, Iq, Message, Presence } from "../lib/stanza";
import { XMPPElement } from "../lib/ltx/Element";
import { JID } from "../lib/JID";
import type { Connection } from "../lib/connection";

const fakeConnection = {} as unknown as Connection;

function buildMessageXml(options?: {
  to?: string;
  from?: string;
  type?: string;
  body?: string;
  subject?: string;
  children?: XMPPElement[];
}) {
  const el = XMPPElement.createElementNS("jabber:client", "message");
  if (options?.to) el.setAttribute("to", options.to);
  if (options?.from) el.setAttribute("from", options.from);
  if (options?.type) el.setAttribute("type", options.type);
  if (options?.subject) {
    const s = XMPPElement.createElement("subject");
    s.textContent = options.subject;
    el.appendChild(s);
  }
  if (options?.body) {
    const b = XMPPElement.createElement("body");
    b.textContent = options.body;
    el.appendChild(b);
  }
  for (const child of options?.children ?? []) {
    el.appendChild(child);
  }
  return el;
}

describe("StanzaBase", () => {
  describe("parseBaseStanza", () => {
    it("应分发 iq", () => {
      const el = XMPPElement.createElementNS("jabber:client", "iq");
      el.setAttribute("type", "get");
      const result = StanzaBase.parseBaseStanza(el);
      expect(result).toHaveProperty("iq.type", "get");
    });

    it("应分发 message", () => {
      const el = buildMessageXml({ type: "chat" });
      const result = StanzaBase.parseBaseStanza(el);
      expect(result).toHaveProperty("message.type", "chat");
    });

    it("应分发 presence", () => {
      const el = XMPPElement.createElementNS("jabber:client", "presence");
      const result = StanzaBase.parseBaseStanza(el);
      expect(result).toHaveProperty("presence");
    });

    it("未知 stanza 应抛错", () => {
      const el = XMPPElement.createElement("stream:error");
      expect(() => StanzaBase.parseBaseStanza(el)).toThrow("未知的stanza");
    });
  });

  describe("constructor", () => {
    it("含 @ 的 to/from 应转换为 JID", () => {
      const el = XMPPElement.createElement("presence");
      el.setAttribute("to", "juliet@capulet.lit");
      el.setAttribute("from", "coven@chat.shakespeare.lit/thirdwitch");
      const p = new StanzaBase(el, fakeConnection);
      expect(p.to).toBeInstanceOf(JID);
      expect(p.from).toBeInstanceOf(JID);
    });

    it("不含 @ 的域 JID 也应转换为 JID", () => {
      const el = XMPPElement.createElement("presence");
      el.setAttribute("to", "capulet.lit");
      const p = new StanzaBase(el, fakeConnection);
      expect(p.to).toBeInstanceOf(JID);
      expect(p.to?.bare).toBe("capulet.lit");
      expect(p.from).toBeUndefined();
    });

    it("应暴露 id 和 tagName", () => {
      const el = XMPPElement.createElement("message");
      el.setAttribute("id", "msg-1");
      const p = new StanzaBase(el, fakeConnection);
      expect(p.id).toBe("msg-1");
      expect(p.tagName).toBe("message");
    });
  });

  describe("toString", () => {
    it("应序列化为 XML 字符串", () => {
      const el = buildMessageXml({ body: "hi" });
      const p = new StanzaBase(el, fakeConnection);
      expect(p.toString()).toContain("<message");
      expect(p.toString()).toContain("hi");
    });
  });

  describe("send", () => {
    it("应委托给 connection.send", () => {
      const send = vi.fn();
      const conn = { send } as unknown as Connection;
      const el = XMPPElement.createElement("presence");
      const p = new StanzaBase(el, conn);
      p.send(el);
      expect(send).toHaveBeenCalledWith(el);
    });
  });

  describe("error 解析", () => {
    const STANZAS_NS = "urn:ietf:params:xml:ns:xmpp-stanzas";

    /** 构造 `<error type>` 及指定条件与可选说明文本 */
    function buildErrorEl(type: string, condition: string, text?: string) {
      const el = XMPPElement.createElementNS("jabber:client", "error", { type });
      el.appendChild(XMPPElement.createElementNS(STANZAS_NS, condition));
      if (text) {
        const textEl = XMPPElement.createElementNS(STANZAS_NS, "text");
        textEl.textContent = text;
        el.appendChild(textEl);
      }
      return el;
    }

    it("type=error 时解析直接子元素 <error/>", () => {
      const el = buildMessageXml({
        type: "error",
        children: [buildErrorEl("cancel", "item-not-found", "节点不存在")],
      });
      expect(new Message(el, fakeConnection).error).toEqual({
        type: "cancel",
        condition: "item-not-found",
        text: "节点不存在",
      });
    });

    it("type 非 error 时不解析 <error/>（RFC 6120 §8.3.1 规则 7）", () => {
      const el = buildMessageXml({
        type: "chat",
        children: [buildErrorEl("cancel", "item-not-found")],
      });
      expect(new Message(el, fakeConnection).error).toBeUndefined();
    });
  });
});

describe("Iq", () => {
  describe("parseIq", () => {
    it("应解析属性和子节点", () => {
      const el = XMPPElement.createElementNS("jabber:client", "iq");
      el.setAttribute("id", "iq-1");
      el.setAttribute("to", "juliet@capulet.lit");
      el.setAttribute("type", "get");
      const query = XMPPElement.createElementNS("jabber:iq:roster", "query");
      el.appendChild(query);
      const result = Iq.parseIq(el).iq;
      expect(result.id).toBe("iq-1");
      expect(result.to).toBeInstanceOf(JID);
      expect(result.type).toBe("get");
      expect(result["query-0"]).toBe(query);
    });

    it("同名子节点应各自保留", () => {
      const el = XMPPElement.createElementNS("jabber:client", "iq");
      el.setAttribute("type", "get");
      const first = XMPPElement.createElementNS("urn:example:first", "query");
      const second = XMPPElement.createElementNS("urn:example:second", "query");
      el.appendChild(first);
      el.appendChild(second);
      const result = Iq.parseIq(el).iq;
      expect(result["query-0"]).toBe(first);
      expect(result["query-1"]).toBe(second);
    });
  });

  describe("constructor", () => {
    it("缺少 type 时应抛错", () => {
      const el = XMPPElement.createElementNS("jabber:client", "iq");
      expect(() => new Iq(el, fakeConnection)).toThrow("iq节点必须有type属性");
    });

    it("不应将子节点挂载到实例", () => {
      const el = XMPPElement.createElementNS("jabber:client", "iq");
      el.setAttribute("type", "get");
      const query = XMPPElement.createElementNS("jabber:iq:roster", "query");
      el.appendChild(query);
      const iq = new Iq(el, fakeConnection);
      expect(iq.type).toBe("get");
      expect(iq["query-0"]).toBeUndefined();
    });
  });

  describe("createIq", () => {
    it("应创建带 type 和 query 命名空间的 iq", () => {
      const el = Iq.createIq("get", "juliet@capulet.lit", "jabber:iq:roster");
      expect(el.tagName).toBe("iq");
      expect(el.getAttribute("type")).toBe("get");
      expect(el.getAttribute("to")).toBe("juliet@capulet.lit");
      const query = Array.from(el.children)[0];
      expect(query).toBeInstanceOf(XMPPElement);
      expect(query.namespaceURI).toBe("jabber:iq:roster");
    });

    it("应创建不含 to 和 query 的最小 iq", () => {
      const el = Iq.createIq("result");
      expect(el.getAttribute("to")).toBeNull();
      expect(el.childNodes).toEqual([]);
    });
  });
});

describe("Message", () => {
  describe("parseMessage", () => {
    it("应解析基本属性", () => {
      const el = buildMessageXml({
        to: "juliet@capulet.lit",
        from: "coven@chat.shakespeare.lit/thirdwitch",
        type: "chat",
        body: "hello",
        subject: "topic",
      });
      const msg = Message.parseMessage(el).message;
      expect(msg.to).toBeInstanceOf(JID);
      expect(msg.from).toBeInstanceOf(JID);
      expect(msg.type).toBe("chat");
      expect(msg.body).toBe("hello");
      expect(msg.subject).toBe("topic");
    });

    it("type 缺省应为 normal", () => {
      const el = buildMessageXml({ body: "hi" });
      expect(Message.parseMessage(el).message.type).toBe("normal");
    });

    it("headline 是合法 type,不应被降级", () => {
      const el = buildMessageXml({ type: "headline", body: "news" });
      expect(Message.parseMessage(el).message.type).toBe("headline");
    });

    it("未知 type 应降级为 normal（RFC 6121 §5.2.2）", () => {
      const el = buildMessageXml({ type: "unknown-type", body: "hi" });
      expect(Message.parseMessage(el).message.type).toBe("normal");
    });

    it("body 和 subject 缺省应为 null", () => {
      const el = buildMessageXml({ type: "chat" });
      const msg = Message.parseMessage(el).message;
      expect(msg.body).toBeNull();
      expect(msg.subject).toBeNull();
    });

    it("多个 body 时只保留第一个", () => {
      const el = buildMessageXml({ body: "first" });
      const second = XMPPElement.createElement("body");
      second.textContent = "second";
      el.appendChild(second);
      expect(Message.parseMessage(el).message.body).toBe("first");
    });

    it("应按 xml:lang 收集 bodies", () => {
      const el = buildMessageXml({ type: "chat" });
      const zh = XMPPElement.createElement("body");
      zh.setAttribute("xml:lang", "zh");
      zh.textContent = "你好";
      const en = XMPPElement.createElement("body");
      en.setAttribute("xml:lang", "en");
      en.textContent = "hello";
      const plain = XMPPElement.createElement("body");
      plain.textContent = "no lang";
      el.appendChild(zh);
      el.appendChild(en);
      el.appendChild(plain);
      const msg = Message.parseMessage(el).message;
      expect(msg.body).toBe("你好");
      expect(msg.bodies).toEqual({
        zh: "你好",
        en: "hello",
      });
      // 无语言标签的 body 不进入字典
      expect(msg.bodies[""]).toBeUndefined();
    });

    it("应按 xml:lang 收集 subjects", () => {
      const el = buildMessageXml({ type: "chat" });
      const zh = XMPPElement.createElement("subject");
      zh.setAttribute("xml:lang", "zh");
      zh.textContent = "主题";
      const en = XMPPElement.createElement("subject");
      en.setAttribute("xml:lang", "en");
      en.textContent = "topic";
      el.appendChild(zh);
      el.appendChild(en);
      const msg = Message.parseMessage(el).message;
      expect(msg.subject).toBe("主题");
      expect(msg.subjects).toEqual({
        zh: "主题",
        en: "topic",
      });
    });

    it("无 body 时 bodies 应为空对象", () => {
      const el = buildMessageXml({ type: "chat" });
      expect(Message.parseMessage(el).message.bodies).toEqual({});
      expect(Message.parseMessage(el).message.subjects).toEqual({});
    });

    it("应忽略 XEP 子元素中嵌套的 subject", () => {
      const el = buildMessageXml({ type: "chat" });
      const x = XMPPElement.createElementNS("some:xep", "x");
      const nested = XMPPElement.createElement("subject");
      nested.textContent = "nested";
      x.appendChild(nested);
      el.appendChild(x);
      expect(Message.parseMessage(el).message.subject).toBeNull();
    });

    it("应收集其余子节点", () => {
      const el = buildMessageXml({ type: "chat" });
      const x = XMPPElement.createElementNS("some:xep", "x");
      el.appendChild(x);
      const msg = Message.parseMessage(el).message;
      expect(msg["x-0"]).toBe(x);
    });

    it("同名子节点应各自保留", () => {
      const el = buildMessageXml({ type: "chat" });
      const mucUser = XMPPElement.createElementNS("http://jabber.org/protocol/muc#user", "x");
      const vcardUpdate = XMPPElement.createElementNS("vcard-temp:x:update", "x");
      el.appendChild(mucUser);
      el.appendChild(vcardUpdate);
      const msg = Message.parseMessage(el).message;
      expect(msg["x-0"]).toBe(mucUser);
      expect(msg["x-1"]).toBe(vcardUpdate);
    });

    it("应解析 thread", () => {
      const thread = XMPPElement.createElement("thread");
      thread.textContent = "0e3141cd80894871a68e6fe6b1ec56fa";
      const el = buildMessageXml({ type: "chat", children: [thread] });
      expect(Message.parseMessage(el).message.thread).toBe("0e3141cd80894871a68e6fe6b1ec56fa");
    });
  });

  describe("constructor", () => {
    it("应暴露解析出的字段", () => {
      const el = buildMessageXml({ type: "groupchat", body: "hi" });
      const msg = new Message(el, fakeConnection);
      expect(msg.type).toBe("groupchat");
      expect(msg.body).toBe("hi");
    });
  });

  describe("createMessage", () => {
    it("应创建带 to 和 body 的 message", () => {
      const el = Message.createMessage("juliet@capulet.lit", "hi", "chat");
      expect(el.tagName).toBe("message");
      expect(el.getAttribute("to")).toBe("juliet@capulet.lit");
      expect(el.getAttribute("type")).toBe("chat");
      expect(Array.from(el.children)[0]?.textContent).toBe("hi");
    });

    it("type 缺省为 normal,空 body 应省略", () => {
      const el = Message.createMessage("juliet@capulet.lit");
      expect(el.getAttribute("type")).toBe("normal");
      expect(el.childNodes).toEqual([]);
    });
  });
});

describe("Presence", () => {
  function buildPresenceXml(options?: {
    type?: string;
    show?: string;
    status?: string;
    children?: XMPPElement[];
  }) {
    const el = XMPPElement.createElementNS("jabber:client", "presence");
    if (options?.type) el.setAttribute("type", options.type);
    if (options?.show) {
      const s = XMPPElement.createElement("show");
      s.textContent = options.show;
      el.appendChild(s);
    }
    if (options?.status) {
      const s = XMPPElement.createElement("status");
      s.textContent = options.status;
      el.appendChild(s);
    }
    for (const child of options?.children ?? []) {
      el.appendChild(child);
    }
    return el;
  }

  describe("parsePresence", () => {
    it("应解析 show/status/type", () => {
      const el = buildPresenceXml({ type: "unavailable", show: "dnd", status: "busy" });
      const presence = Presence.parsePresence(el).presence;
      expect(presence.type).toBe("unavailable");
      expect(presence.show).toBe("dnd");
      expect(presence.status).toBe("busy");
    });

    it("缺省时 show 应为 undefined", () => {
      const el = buildPresenceXml();
      const presence = Presence.parsePresence(el).presence;
      expect(presence.show).toBeUndefined();
      expect(presence.status).toBeUndefined();
    });

    it("应忽略 XEP 子元素中嵌套的 show/status", () => {
      const el = buildPresenceXml();
      const x = XMPPElement.createElementNS("some:xep", "x");
      const show = XMPPElement.createElement("show");
      show.textContent = "dnd";
      const status = XMPPElement.createElement("status");
      status.textContent = "busy";
      x.appendChild(show);
      x.appendChild(status);
      el.appendChild(x);
      const presence = Presence.parsePresence(el).presence;
      expect(presence.show).toBeUndefined();
      expect(presence.status).toBeUndefined();
    });

    it("多个 show 时只保留第一个", () => {
      const el = buildPresenceXml({ show: "away" });
      const second = XMPPElement.createElement("show");
      second.textContent = "dnd";
      el.appendChild(second);
      expect(Presence.parsePresence(el).presence.show).toBe("away");
    });

    it("应收集其余子节点", () => {
      const el = buildPresenceXml();
      const x = XMPPElement.createElementNS("some:xep", "x");
      el.appendChild(x);
      expect(Presence.parsePresence(el).presence["x-0"]).toBe(x);
    });

    it("同名子节点应各自保留", () => {
      const el = buildPresenceXml();
      const mucUser = XMPPElement.createElementNS("http://jabber.org/protocol/muc#user", "x");
      const vcardUpdate = XMPPElement.createElementNS("vcard-temp:x:update", "x");
      el.appendChild(mucUser);
      el.appendChild(vcardUpdate);
      const presence = Presence.parsePresence(el).presence;
      expect(presence["x-0"]).toBe(mucUser);
      expect(presence["x-1"]).toBe(vcardUpdate);
    });
  });

  describe("constructor", () => {
    it("应暴露解析出的字段", () => {
      const el = buildPresenceXml({ type: "subscribe", show: "chat" });
      const p = new Presence(el, fakeConnection);
      expect(p.type).toBe("subscribe");
      expect(p.show).toBe("chat");
    });
  });

  describe("createPresence", () => {
    it("应创建带 to 和 type 的 presence", () => {
      const el = Presence.createPresence("user@example.com", "subscribe");
      expect(el.tagName).toBe("presence");
      expect(el.getAttribute("to")).toBe("user@example.com");
      expect(el.getAttribute("type")).toBe("subscribe");
    });

    it("未提供 type 时应省略", () => {
      const el = Presence.createPresence("user@example.com");
      expect(el.getAttribute("type")).toBeNull();
    });
  });
});
