import { describe, expect, it } from "vitest";
import { Parser } from "../../lib/ltx/Parser";
import {
  XMPPElementCollection,
  XMPPNodeList,
} from "../../lib/ltx/XMPPElementCollection";

const XML = `<message xmlns="jabber:client"><body>hi</body><thread>t</thread></message>`;

describe("XMPPElementCollection", () => {
  const el = Parser.parse(XML);

  it("原生数组形态的 instanceof 由 Symbol.hasInstance 支撑", () => {
    const children = el.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children).toBeInstanceOf(XMPPElementCollection);
    expect(children).not.toBeInstanceOf(XMPPNodeList);
  });

  it("XMPPNodeList 同时是 XMPPElementCollection 实例", () => {
    const nodes = el.querySelectorAll("body");
    expect(nodes).toBeInstanceOf(XMPPNodeList);
    expect(nodes).toBeInstanceOf(XMPPElementCollection);
  });

  it("getElementsByTagName 返回集合", () => {
    expect(el.getElementsByTagName("body")).toBeInstanceOf(
      XMPPElementCollection,
    );
  });

  it("普通数组不命中集合判断", () => {
    expect([]).not.toBeInstanceOf(XMPPElementCollection);
    expect([]).not.toBeInstanceOf(XMPPNodeList);
  });
});
