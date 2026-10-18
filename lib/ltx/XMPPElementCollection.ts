import type { XMPPElement } from "./Element.js";

/**
 * 只读元素集合（DOM 风味，不是 WHATWG DOM 的 `NodeList` / `HTMLCollection` 实现）。
 *
 * 运行时是原生数组快照（非 live），因此保留 `Array.from`、下标、迭代的快速路径。
 * 支持数字下标、`length`、`item()`、迭代与 `forEach`；不含 HTML 文档模型专有的
 * `namedItem()`（XMPP 的 `id` 属性没有该语义）。
 *
 * 局限性：
 * - `instanceof` 由 `Symbol.hasInstance` 按 `Symbol.toStringTag` 判断，不是真实原型关系；
 *   `Object.getPrototypeOf()` / `isPrototypeOf()` 不会指向本类。
 * - `Symbol.toStringTag` 是自定义名字，不是 DOM 的 `"NodeList"` / `"HTMLCollection"`，
 *   依赖 `[object NodeList]` 嗅探集合类型的库代码认不出本实现。
 * - 集合是创建时的快照，节点树后续变化不会自动反映。
 *
 * 需要更多 DOM 集合行为时请提 issue，不要假定这里是完整 DOM 实现。
 */
export class XMPPElementCollection<T extends XMPPElement = XMPPElement>
  implements Iterable<T>
{
  readonly [index: number]: T;

  declare readonly length: number;

  declare item: (index: number) => T | null;

  declare forEach: (
    callback: (item: T, index: number, list: readonly T[]) => void,
    thisArg?: unknown,
  ) => void;

  declare [Symbol.iterator]: () => IterableIterator<T>;

  constructor(elements: T[]) {
    // 返回原生数组而非 this，才能保留 Array.from、迭代与下标的快速路径
    return XMPPElementCollection.attach(
      elements,
      new.target === XMPPNodeList ? "XMPPNodeList" : "XMPPElementCollection",
    );
  }

  /**
   * 让 `instanceof` 对原生数组形态的实例成立。
   *
   * 实例是构造函数返回的数组，原型为 `Array.prototype`，默认的原型链判断永远为 false；
   * 这里改按 `Symbol.toStringTag` 识别。`XMPPNodeList` 是子类，所以也接受它的标签。
   * 这只是 `instanceof` 的模拟：`Object.getPrototypeOf()` / `isPrototypeOf()` 仍不适用。
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    const tag = (value as unknown as Record<symbol, unknown>)[
      Symbol.toStringTag
    ];
    return tag === "XMPPElementCollection" || tag === "XMPPNodeList";
  }

  /**
   * 把 `item()` 与 `Symbol.toStringTag` 挂到结果数组上并返回数组。
   * 返回数组而非 `this`，以保留 `Array.from`、迭代与下标的原生快速路径。
   */
  private static attach<T extends XMPPElement>(
    elements: T[],
    tag: string,
  ): XMPPElementCollection<T> {
    const list = elements as T[] & {
      item: (index: number) => T | null;
    };
    list.item = XMPPElementCollection.item as unknown as (
      index: number,
    ) => T | null;
    (list as unknown as Record<symbol, string>)[Symbol.toStringTag] = tag;
    return list;
  }

  /** 按下标取元素，负值或越界返回 null */
  private static item(this: readonly XMPPElement[], index: number): XMPPElement | null {
    return this[index] ?? null;
  }
}

/**
 * `querySelectorAll` 的返回值；DOM 风味，与 `XMPPElementCollection` 形状一致，仅作类型区分。
 *
 * `instanceof` 语义与 DOM 继承一致：NodeList 实例同时是 XMPPElementCollection 实例，反向不成立。
 * 与父类相同，这只是 `Symbol.hasInstance` 的模拟，不是真实原型关系。
 */
export class XMPPNodeList<
  T extends XMPPElement = XMPPElement,
> extends XMPPElementCollection<T> {
  /** 只认 NodeList 标签，避免 Collection 实例被误判为 NodeList。 */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    return (
      (value as unknown as Record<symbol, unknown>)[Symbol.toStringTag] ===
      "XMPPNodeList"
    );
  }
}
