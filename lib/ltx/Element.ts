import {
  XMPPElementCollection,
  XMPPNodeList,
} from "./XMPPElementCollection.js";
import { escapeXML, escapeXMLText } from "./escape.js";
import QuerySelector from "./QuerySelector.js";
/** DOM-inspired：文本节点用 string，元素节点用 XMPPElement */
type XMPPNode = XMPPElement | string;

/**
 * 无属性元素共享的空属性表（null 原型 + 冻结）。
 * 冻结同时是「这张表不属于本元素」的标记：首次写入属性时才复制成自己的表。
 */
const EMPTY_ATTRS = Object.freeze(
  Object.create(null) as Record<string, string>,
);

/**
 * DOM-inspired XML 元素（XMPP/LTX）。
 *
 * 命名与常用行为贴近 DOM，但不是完整 WHATWG 实现：
 * - 只实现 XMPP 所需的 DOM 子集，选择器支持范围见 QuerySelector。
 * - 集合（`childNodes` / `children` / `getElementsByTagName*` / `querySelectorAll`）
 */
export class XMPPElement {
  public readonly tagName: string;
  /** `tagName` 的前缀部分，undefined 表示尚未计算（首次访问 prefix 时填充） */
  private _prefix?: string | null;
  /** `tagName` 的本地名，undefined 表示尚未计算（首次访问 localName 时填充） */
  private _localName?: string;
  private _parentNode: XMPPElement | null = null;
  /** 内部可写子节点列表 */
  private _childNodes: XMPPNode[] = [];
  /** 无原型属性表，允许安全使用 constructor、toString、__proto__ 等 XML 属性名；冻结表示这张表不属于本元素（共享空表或解析器交出的表） */
  private _attrs: Record<string, string> = EMPTY_ATTRS;

  /** 取可写的属性表：冻结表（共享空表或解析器交出的表）首次写入时复制成自己的表 */
  private _ensureAttrs(): Record<string, string> {
    if (this._attrs === EMPTY_ATTRS) {
      this._attrs = Object.create(null) as Record<string, string>;
    } else if (Object.isFrozen(this._attrs)) {
      const own = Object.create(null) as Record<string, string>;
      Object.assign(own, this._attrs);
      this._attrs = own;
    }
    return this._attrs;
  }

  /**
   * TIP: 请使用 createElement / createElementNS 创建实例
   * @param tagName 元素的标签名
   * @param namespaceURI 元素的命名空间 URI
   * @param qualifiedName 元素的限定名
   */
  private constructor(
    tagName?: string,
    namespaceURI: string | null = null,
    qualifiedName?: string,
  ) {
    // 私有调用点只有两种形态：createElement 传 tagName，createElementNS 传 qualifiedName
    this.tagName = (tagName || qualifiedName)!;

    if (namespaceURI) {
      // 新建元素的 _attrs 必为共享空表，直接换成本元素的表
      this._attrs = Object.create(null) as Record<string, string>;
      this._attrs[this.prefix ? `xmlns:${this.prefix}` : "xmlns"] =
        namespaceURI;
    }
  }

  /** 只读子节点列表（DOM 风味快照，非 live；运行时是原生数组） */
  public get childNodes(): readonly XMPPNode[] {
    return this._childNodes;
  }

  /**
   * 获取元素标签名的前缀 (e.g., "ns:tag" -> "ns")。
   */
  public get prefix(): string | null {
    if (this._prefix === undefined) {
      const idx = this.tagName.indexOf(":");
      this._prefix = idx >= 0 ? this.tagName.slice(0, idx) : null;
    }
    return this._prefix;
  }

  /**
   * 获取不带前缀的本地名称 (e.g., "ns:tag" -> "tag")。
   */
  public get localName(): string {
    if (this._localName === undefined) {
      const idx = this.tagName.indexOf(":");
      this._localName = idx >= 0 ? this.tagName.slice(idx + 1) : this.tagName;
    }
    return this._localName;
  }

  /**
   * 获取元素的命名空间 URI。
   */
  public get namespaceURI(): string | null {
    return this._findNS(this.prefix);
  }

  /**
   * 递归向上查找给定前缀的命名空间 URI。
   * @param prefix 要查找的前缀，null 表示默认命名空间。
   * @returns 命名空间 URI 或 null。
   */
  protected _findNS(prefix: string | null): string | null {
    if (prefix) {
      /* 带前缀的命名空间 */
      const attr = "xmlns:" + prefix;
      if (this._attrs[attr]) {
        return this._attrs[attr];
      } else if (this.parentElement) {
        return this.parentElement._findNS(prefix);
      }
    } else {
      /* 默认命名空间 */
      if (this._attrs.xmlns !== undefined) {
        return this._attrs.xmlns || null;
      } else if (this.parentElement) {
        return this.parentElement._findNS(null);
      }
    }
    return null;
  }

  /**
   * 创建一个新的 XMPPElement 实例。
   * @param tagName 元素的标签名
   * @param attrs 可选属性表，值为 null/undefined 时跳过
   * @returns 新创建的 XMPPElement 实例
   */
  public static createElement(
    tagName: string,
    attrs?: Record<string, string | number>,
  ): XMPPElement {
    return XMPPElement._applyAttrs(new XMPPElement(tagName), attrs);
  }

  public static createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    attrs?: Record<string, string | number>,
  ): XMPPElement {
    return XMPPElement._applyAttrs(
      new XMPPElement(undefined, namespaceURI, qualifiedName),
      attrs,
    );
  }

  /**
   * 仅供解析器使用：接管一张 SAX 层产出、此后不再写入的属性表，省去逐键拷贝。
   *
   * 接管前冻结该表（已冻结时是空操作），冻结即「不属于本元素」的标记：
   * 元素之后写属性时会先复制成自己的表，因此通过 `startElement` 事件
   * 拿到同一张表的监听方不会被元素改动影响。
   * @param tagName 元素的标签名
   * @param attrs SAX 产出的属性表；调用方交出后不得再写入
   * @returns 新创建的 XMPPElement 实例
   * @private
   */
  public static _createElementAdoptingAttrs(
    tagName: string,
    attrs: Record<string, string>,
  ): XMPPElement {
    const el = new XMPPElement(tagName);
    el._attrs = attrs;
    return el;
  }

  /** 将属性表写入元素（值为 null/undefined 时跳过；没有任何写入时不建表） */
  private static _applyAttrs(
    el: XMPPElement,
    attrs?: Record<string, string | number>,
  ): XMPPElement {
    if (attrs) {
      let target: Record<string, string> | null = null;
      // Object.keys 只取自有属性，避免 for…in 复制原型链上的键
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value != null) {
          target ??= el._ensureAttrs();
          target[key] = String(value);
        }
      }
    }
    return el;
  }

  /**
   * 子节点参数校验：要求传入值为 XMPPElement，否则抛 TypeError。
   * @param value 待校验的参数值
   * @param method 调用方方法名，用于错误文案
   * @param position 参数位置（从 1 开始）
   */
  private static _assertElement(
    value: unknown,
    method: string,
    position: number,
  ): asserts value is XMPPElement {
    if (!(value instanceof XMPPElement)) {
      throw new TypeError(
        `Failed to execute '${method}' on 'Node': parameter ${position} is not of type 'XMPPElement'.`,
      );
    }
  }

  /**
   * 获取属性值。
   */
  public getAttribute(name: string): string | null {
    return this._attrs[String(name)] ?? null;
  }

  /**
   * 设置属性值（值强制转为字符串）。
   */
  public setAttribute(name: string, val: string): void {
    this._ensureAttrs()[String(name)] = String(val);
  }

  /**
   * 移除属性。
   */
  public removeAttribute(name: string): void {
    const key = String(name);
    // 表里没有该属性时无需复制（冻结表是共享的）
    if (key in this._attrs) {
      delete this._ensureAttrs()[key];
    }
  }

  /**
   * 返回所有直接子元素（只包含元素节点），以 XMPPElementCollection 形式返回。
   */
  public get children(): XMPPElementCollection {
    const result: XMPPElement[] = [];
    for (const child of this._childNodes) {
      if (child instanceof XMPPElement) {
        result.push(child);
      }
    }
    return new XMPPElementCollection(result);
  }

  /** 第一个子元素，无则返回 null */
  public get firstElementChild(): XMPPElement | null {
    for (const child of this._childNodes) {
      if (child instanceof XMPPElement) {
        return child;
      }
    }
    return null;
  }

  /** 最后一个子元素，无则返回 null */
  public get lastElementChild(): XMPPElement | null {
    for (let i = this._childNodes.length - 1; i >= 0; i--) {
      const child = this._childNodes[i];
      if (child instanceof XMPPElement) {
        return child;
      }
    }
    return null;
  }

  /** 直接子元素的数量 */
  public get childElementCount(): number {
    let count = 0;
    for (const child of this._childNodes) {
      if (child instanceof XMPPElement) {
        count++;
      }
    }
    return count;
  }

  /** 同一父节点下紧邻的前一个元素，无则返回 null */
  public get previousElementSibling(): XMPPElement | null {
    const siblings = this._parentNode?._childNodes;
    if (!siblings) {
      return null;
    }
    for (let i = siblings.indexOf(this) - 1; i >= 0; i--) {
      const sibling = siblings[i];
      if (sibling instanceof XMPPElement) {
        return sibling;
      }
    }
    return null;
  }

  /** 同一父节点下紧邻的后一个元素，无则返回 null */
  public get nextElementSibling(): XMPPElement | null {
    const siblings = this._parentNode?._childNodes;
    if (!siblings) {
      return null;
    }
    const start = siblings.indexOf(this);
    if (start === -1) {
      return null;
    }
    for (let i = start + 1; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling instanceof XMPPElement) {
        return sibling;
      }
    }
    return null;
  }

  /**
   * 本节点是否包含给定节点（含自身），对齐 DOM `Node.contains`。
   * @param other 待判定节点；null 返回 false
   */
  public contains(other: XMPPElement | null): boolean {
    for (let p: XMPPElement | null = other; p; p = p.parentNode) {
      if (p === this) {
        return true;
      }
    }
    return false;
  }

  /** 从父节点移除自身（不在父节点子列表中时为 no-op） */
  public remove(): void {
    if (!this._parentNode) return;
    const index = this._parentNode._childNodes.indexOf(this);
    if (index === -1) return;
    this._parentNode._childNodes.splice(index, 1);
    this._parentNode = null;
  }

  /**
   * 获取当前元素内所有文本内容。
   */
  public get textContent(): string {
    let text = "";
    for (const child of this._childNodes) {
      if (typeof child === "string") {
        text += child;
      } else if (child instanceof XMPPElement) {
        text += child.textContent;
      }
    }
    return text;
  }

  /**
   * 设置当前元素的文本内容。null 与空字符串都会清空全部子节点。
   */
  public set textContent(value: string | null) {
    for (const child of this._childNodes) {
      if (child instanceof XMPPElement) {
        child._parentNode = null;
      }
    }
    const text = value == null ? "" : String(value);
    this._childNodes = text ? [text] : [];
  }

  /**
   * 递归获取所有匹配的后代元素。
   */
  public getElementsByTagName(tagName: string): XMPPElementCollection {
    const result: XMPPElement[] = [];
    const traverse = (el: XMPPElement) => {
      for (const child of el._childNodes) {
        if (child instanceof XMPPElement) {
          // 支持通配符 '*' 或精确匹配
          if (tagName === "*" || child.tagName === tagName) {
            result.push(child);
          }
          // 继续递归
          traverse(child);
        }
      }
    };

    traverse(this);
    return new XMPPElementCollection(result);
  }

  /**
   * DOM 风格：
   * - namespaceURI === "" 视为 null
   * - namespaceURI === "*" 匹配任意命名空间
   * - localName === "*" 匹配任意本地名
   */
  public getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): XMPPElementCollection {
    const ns = namespaceURI === "" ? null : namespaceURI;
    const result: XMPPElement[] = [];
    const traverse = (el: XMPPElement) => {
      for (const child of el._childNodes) {
        if (child instanceof XMPPElement) {
          // 先比 localName：namespaceURI 在元素无 xmlns 声明时要上溯父链，名为不匹配的元素不该付这笔钱
          const nameMatch = localName === "*" || child.localName === localName;
          const nsMatch =
            nameMatch && (ns === "*" || child.namespaceURI === ns);
          if (nsMatch) {
            result.push(child);
          }
          traverse(child);
        }
      }
    };
    traverse(this);
    return new XMPPElementCollection(result);
  }

  /**
   * 返回与选择器匹配的第一个后代元素（前序），无匹配返回 null。
   * 选择器只支持 QuerySelector 文档列出的子集，不是完整 CSS 实现。
   * @param selectors CSS 选择器。
   * @returns 匹配的元素。
   */
  public querySelector<E extends XMPPElement = XMPPElement>(
    selectors: string,
  ): E | null {
    return QuerySelector.querySelector(this, selectors) as E | null;
  }

  /**
   * 返回与选择器匹配的所有后代元素（前序），以 XMPPNodeList 形式返回。
   * 集合是 DOM 风味快照；选择器支持范围见 QuerySelector。
   * @param selectors CSS 选择器。
   * @returns 匹配的元素集合。
   */
  public querySelectorAll<E extends XMPPElement = XMPPElement>(
    selectors: string,
  ): XMPPNodeList<E> {
    return new XMPPNodeList<E>(
      QuerySelector.querySelectorAll(this, selectors) as unknown as E[],
    );
  }

  /**
   * 元素自身是否匹配选择器（组合符会沿祖先链判断）。
   * 选择器只支持 QuerySelector 文档列出的子集，不是完整 CSS 实现。
   * @param selectors CSS 选择器。
   * @returns 是否匹配。
   */
  public matches(selectors: string): boolean {
    return QuerySelector.matches(this, selectors);
  }

  /**
   * 追加子元素（DOM 标准风格：appendChild）。
   */
  public appendChild<T extends XMPPElement>(child: T): T {
    XMPPElement._assertElement(child, "appendChild", 1);
    return this.insertBefore(child, null);
  }

  /**
   * 在参考节点前插入子元素；参考节点为 null 时追加到末尾（DOM 标准风格：insertBefore）。
   */
  public insertBefore<T extends XMPPElement>(
    node: T,
    child: XMPPElement | null,
  ): T {
    XMPPElement._assertElement(node, "insertBefore", 1);
    if (child != null) {
      XMPPElement._assertElement(child, "insertBefore", 2);
    }
    if (node === child) {
      return node;
    }
    if (node === (this as XMPPElement)) {
      throw new DOMException(
        "unable to append a node to itself",
        "HierarchyRequestError",
      );
    }
    // 无子节点的节点不可能是本节点的祖先，解析器「新建后立即挂载」的热路径因此零成本
    if (node._childNodes.length > 0 && node.contains(this)) {
      throw new DOMException(
        "The new child element contains the parent.",
        "HierarchyRequestError",
      );
    }
    if (child && !this._childNodes.includes(child)) {
      throw new DOMException(
        "The node before which the new node is to be inserted is not a child of this node.",
        "NotFoundError",
      );
    }

    const prevParent = node._parentNode;
    if (prevParent) {
      prevParent.removeChild(node);
    }
    if (child) {
      this._childNodes.splice(this._childNodes.indexOf(child), 0, node);
    } else {
      // 末尾追加用 push，避免 splice 的通用开销（解析器与构造出站 stanza 都走这里）
      this._childNodes.push(node);
    }
    node._parentNode = this;
    return node;
  }

  /**
   * 移除指定的子元素（DOM 标准风格：removeChild）。
   */
  public removeChild<T extends XMPPElement>(child: T): T {
    XMPPElement._assertElement(child, "removeChild", 1);
    const index = this._childNodes.indexOf(child);
    if (child.parentNode !== this || index === -1) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        "NotFoundError",
      );
    }
    this._childNodes.splice(index, 1);
    child._parentNode = null;
    return child;
  }

  /** 返回父节点（没有父节点则返回 null）。 */
  public get parentNode(): XMPPElement | null {
    return this._parentNode;
  }

  /** 返回父元素（没有父元素则返回 null）。 */
  public get parentElement(): XMPPElement | null {
    return this._parentNode;
  }

  /**
   * 仅供解析器使用：只设置祖先链以提供 xmlns 解析上下文，不把节点加入 childNodes。
   * @param parent 上下文父节点（流头元素），null 表示清除
   */
  public _setParentNode(parent: XMPPElement | null): void {
    this._parentNode = parent;
  }

  /** 追加任意节点（可传多个），并设置对象节点的 parent */
  public append(...nodes: XMPPNode[]): void {
    for (const node of nodes) {
      if (node instanceof XMPPElement) {
        this.appendChild(node);
      } else if (typeof node === "string") {
        this._childNodes.push(node);
      } else {
        throw new TypeError(
          "Failed to execute 'append' on 'Node': parameters must be XMPPElement or string.",
        );
      }
    }
  }

  /** 序列化为 XML 字符串（默认无缩进） */
  public toString(): string {
    return this.toXMLString();
  }

  /**
   * 将元素序列化为 XML 字符串，支持缩进格式化。
   * @param indent 缩进字符串或数字（数字表示空格数）
   * @param level 内部使用，当前缩进级别
   * @returns 格式化的 XML 字符串
   */
  public toXMLString(indent?: string | number, level = 1): string {
    const indentStr = typeof indent === "number" ? " ".repeat(indent) : indent;
    let result = "";
    this._write(
      (chunk) => {
        result += chunk;
      },
      indentStr ?? null,
      level,
    );
    return result;
  }

  /**
   * 写出元素起始标签、属性和结束标签（或自闭合）。
   * @param writer 写入函数
   */
  public write(writer: (chunk: string) => void): void {
    this._write(writer, null, 1);
  }

  /**
   * 序列化的唯一实现；`indent` 为 null 时不缩进。
   * @param writer 写入函数
   * @param indent 缩进串，仅当全部子节点为元素时生效
   * @param level 当前缩进级别
   */
  private _write(
    writer: (chunk: string) => void,
    indent: string | null,
    level: number,
  ): void {
    writer("<");
    writer(this.tagName);
    for (const k in this._attrs) {
      const v = this._attrs[k];
      if (v != null) {
        writer(" ");
        writer(k);
        writer('="');
        writer(escapeXML(v));
        writer('"');
      }
    }
    if (this._childNodes.length === 0) {
      writer("/>");
      return;
    }

    // 仅全部子节点为元素时才缩进：对混合内容缩进会插入真实空白，序列化结果无法回读
    const prettyIndent =
      indent && this._childNodes.every((child) => child instanceof XMPPElement)
        ? indent
        : null;
    writer(">");
    for (const child of this._childNodes) {
      if (child == null) continue;
      if (prettyIndent) {
        writer("\n" + prettyIndent.repeat(level));
      }
      if (child instanceof XMPPElement) {
        child._write(writer, indent, level + 1);
      } else if (typeof child === "string") {
        writer(escapeXMLText(child));
      } else {
        // 兜底：其他类型子节点按字符串形式写出，避免静默丢数据
        writer(escapeXMLText(String(child)));
      }
    }
    if (prettyIndent) {
      writer("\n" + prettyIndent.repeat(level - 1));
    }
    writer("</");
    writer(this.tagName);
    writer(">");
  }
}