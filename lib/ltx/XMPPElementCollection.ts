import type { XMPPElement } from "./Element.js";

/** 集合快照的内部存储键（Symbol 键不会被 Proxy 的字符串分支暴露） */
const ITEMS = Symbol("items");

/**
 * 只读元素集合，语义对齐 DOM 集合（快照，非 live）。
 *
 * 支持数字下标、`item()`、迭代与 `forEach`；不含 HTML 文档模型专有的
 * `namedItem()`（XMPP 的 `id` 属性没有该语义）。
 */
export class XMPPElementCollection implements Iterable<XMPPElement> {
  [index: number]: XMPPElement;

  private readonly [ITEMS]: readonly XMPPElement[];

  /**
   * @param elements 集合快照（构造后不再变化）
   */
  constructor(elements: readonly XMPPElement[]) {
    this[ITEMS] = elements;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (property === "length") {
          return elements.length;
        }
        if (property in target || typeof property === "symbol") {
          return Reflect.get(target, property, receiver);
        }
        const index = Number(property);
        return Number.isInteger(index) ? elements[index] : undefined;
      },
      has(target, property) {
        if (property in target || typeof property === "symbol") {
          return true;
        }
        const index = Number(property);
        return Number.isInteger(index) && index >= 0 && index < elements.length;
      },
      ownKeys() {
        return Object.keys(elements);
      },
      getOwnPropertyDescriptor(target, property) {
        if (property in target || typeof property === "symbol") {
          return Reflect.getOwnPropertyDescriptor(target, property);
        }
        const index = Number(property);
        if (Number.isInteger(index) && index >= 0 && index < elements.length) {
          return {
            value: elements[index],
            writable: false,
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });
  }

  /** 集合中的元素数量 */
  public get length(): number {
    return this[ITEMS].length;
  }

  /**
   * 按下标取元素。
   * @param index 下标（负值或越界返回 null）
   */
  public item(index: number): XMPPElement | null {
    const elements = this[ITEMS];
    return index >= 0 && elements[index] ? elements[index] : null;
  }

  [Symbol.iterator](): Iterator<XMPPElement> {
    return this[ITEMS][Symbol.iterator]();
  }

  /**
   * 遍历集合。
   * @param callback 回调，接收（元素, 下标, 集合本身）
   * @param thisArg 回调执行时的 this
   */
  public forEach(
    callback: (item: XMPPElement, index: number, list: this) => void,
    thisArg?: unknown,
  ): void {
    const elements = this[ITEMS];
    for (let i = 0; i < elements.length; i++) {
      callback.call(thisArg, elements[i], i, this);
    }
  }

  public get [Symbol.toStringTag](): string {
    return "XMPPElementCollection";
  }
}

/** `querySelectorAll` 的返回值；与 XMPPElementCollection 形状一致，仅作类型区分 */
export class XMPPNodeList extends XMPPElementCollection {
  public get [Symbol.toStringTag](): string {
    return "XMPPNodeList";
  }
}
