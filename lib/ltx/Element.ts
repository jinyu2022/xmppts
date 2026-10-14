import { XMPPElementCollection, XMPPNodeList } from "./XMPPElementCollection.js";
import { escapeXML, escapeXMLText } from "./escape.js";
import QuerySelector from "./QuerySelector.js";
/** DOM-inspired：文本节点用 string，元素节点用 XMPPElement */
type XMPPNode = XMPPElement | string;

/**
 * 无属性元素共享的空属性表（null 原型 + 冻结）。
 * 冻结同时是「这张表不属于本元素」的标记：首次写入属性时才复制成自己的表。
 */
const EMPTY_ATTRS = Object.freeze(Object.create(null) as Record<string, string>);

/**
 * DOM-inspired XML 元素（XMPP/LTX）。
 * 命名与常用行为贴近 DOM，但不是完整 WHATWG 实现。
 */
export class XMPPElement {
  public readonly tagName: string;
  private _parentNode: XMPPElement | null = null;
  /** 内部可写子节点列表 */
  private _childNodes: XMPPNode[] = [];
  /** 无原型属性表，允许安全使用 constructor、toString、__proto__ 等 XML 属性名；冻结表示这张表不属于本元素（共享空表或解析器交出的表） */
  private _attrs: Record<string, string> = EMPTY_ATTRS;

  /** 取可写的属性表：冻结表（共享空表或解析器交出的表）首次写入时复制成自己的表 */
  private _ensureAttrs(): Record<string, string> {
    if (this._attrs === EMPTY_ATTRS) {
      this._attrs = Object.create(null) as Record<string, string>;
    } else if(Object.isFrozen(this._attrs)) {
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
    if (qualifiedName && !tagName) {
      this.tagName = qualifiedName;
    } else if (tagName && !namespaceURI && !qualifiedName) {
      this.tagName = tagName;
    } else {
      throw new Error("必须提供 tagName 或 qualifiedName");
    }

    if (namespaceURI) {
      // 新建元素的 _attrs 必为共享空表，直接换成本元素的表
      this._attrs = Object.create(null) as Record<string, string>;
      this._attrs[this.prefix ? `xmlns:${this.prefix}` : "xmlns"] = namespaceURI;
    }
  }

  /** 只读子节点列表（DOM 风格） */
  public get childNodes(): readonly XMPPNode[] {
    return this._childNodes;
  }

  /**
   * 获取元素标签名的前缀 (e.g., "ns:tag" -> "ns")。
   */
  public get prefix(): string | null {
    const idx = this.tagName.indexOf(":");
    return idx >= 0 ? this.tagName.slice(0, idx) : null;
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
    namespaceURI: string,
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
   */
  public static _createElementAdoptingAttrs(
    tagName: string,
    attrs: Record<string, string>,
  ): XMPPElement {
    Object.freeze(attrs);
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
   * 获取不带前缀的本地名称 (e.g., "ns:tag" -> "tag")。
   */
  public get localName(): string {
    const idx = this.tagName.indexOf(":");
    return idx >= 0 ? this.tagName.slice(idx + 1) : this.tagName;
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
  public setAttribute(name: string, val: string): this {
    this._ensureAttrs()[String(name)] = String(val);
    return this;
  }

  /**
   * 移除属性。
   */
  public removeAttribute(name: string): this {
    const key = String(name);
    // 表里没有该属性时无需复制（冻结表是共享的）
    if (key in this._attrs) {
      delete this._ensureAttrs()[key];
    }
    return this;
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
   * @param other 待判定节点
   */
  public contains(other: XMPPElement): boolean {
    for (let p: XMPPElement | null = other; p; p = p.parentNode) {
      if (p === this) {
        return true;
      }
    }
    return false;
  }

  /** 从父节点移除自身（不在父节点子列表中时为 no-op） */
  public remove(): void {
    const parent = this._parentNode;
    if (parent?._childNodes.includes(this)) {
      parent.removeChild(this);
    }
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
  public set textContent(value: string) {
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
          const nsMatch = ns === "*" || child.namespaceURI === ns;
          const nameMatch = localName === "*" || child.localName === localName;
          if (nsMatch && nameMatch) {
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
   * @param selectors CSS 选择器。
   * @returns 匹配的元素。
   */
  public querySelector(selectors: string): XMPPElement | null {
    return QuerySelector.querySelector(this, selectors);
  }

  /**
   * 返回与选择器匹配的所有后代元素（前序），以 XMPPNodeList 形式返回。
   * @param selectors CSS 选择器。
   * @returns 匹配的元素集合。
   */
  public querySelectorAll(selectors: string): XMPPNodeList {
    return new XMPPNodeList(QuerySelector.querySelectorAll(this, selectors));
  }

  /**
   * 元素自身是否匹配选择器（组合符会沿祖先链判断）。
   * @param selectors CSS 选择器。
   * @returns 是否匹配。
   */
  public matches(selectors: string): boolean {
    return QuerySelector.matches(this, selectors);
  }

  /**
   * 追加子元素（DOM 标准风格：appendChild）。
   */
  public appendChild(child: XMPPElement): XMPPElement {
    return this.insertBefore(child, null);
  }

  /** node 是否为本节点自身或祖先（用于环检测） */
  private _hasAncestor(node: XMPPElement): boolean {
    if (node === this) {
      return true;
    }
    for (let p = this.parentNode; p; p = p.parentNode) {
      if (p === node) {
        return true;
      }
    }
    return false;
  }

  /**
   * 在参考节点前插入子元素；参考节点为 null 时追加到末尾（DOM 标准风格：insertBefore）。
   */
  public insertBefore<T extends XMPPElement>(
    node: T,
    child: XMPPElement | null,
  ): T {
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
    if (node._childNodes.length > 0 && this._hasAncestor(node)) {
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
  public removeChild(child: XMPPElement): XMPPElement {
    const index = this._childNodes.indexOf(child);
    if (child.parentNode !== this || index === -1) {
      throw new DOMException(
        "The node to be removed is not a child of this node.",
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
      } else {
        this._childNodes.push(node);
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
  public toXMLString(indent?: string | number, level: number = 1): string {
    const indentStr = typeof indent === "number" ? " ".repeat(indent) : indent;

    let s = `<${this.tagName}`;

    // 添加属性
    for (const k in this._attrs) {
      const v = this._attrs[k];
      if (v != null) {
        s += ` ${k}="${escapeXML(v)}"`;
      }
    }

    const children_length = this._childNodes.length;

    if (children_length === 1 && typeof this._childNodes[0] === "string") {
      s += `>${escapeXMLText(this._childNodes[0])}</${this.tagName}>`;
    } else if (children_length > 0) {
      // 仅全部子节点为元素时才缩进：对混合内容缩进会插入真实空白，序列化结果无法回读
      const prettyIndent =
        indentStr && this._childNodes.every((child) => child instanceof XMPPElement)
          ? indentStr
          : null;
      s += ">";
      for (const child of this._childNodes) {
        if (child == null) continue;

        if (prettyIndent) {
          s += "\n" + prettyIndent.repeat(level);
        }

        if (typeof child === "string") {
          s += escapeXMLText(child);
        } else if (child instanceof XMPPElement) {
          s += child.toXMLString(indentStr, level + 1);
        } else {
          // 兜底：其它类型（如 number）按其字符串形式序列化，避免静默丢数据
          s += escapeXMLText(String(child));
        }
      }

      if (prettyIndent) {
        s += "\n" + prettyIndent.repeat(level - 1);
      }
      s += `</${this.tagName}>`;
    } else {
      // 空元素
      s += "/>";
    }

    return s;
  }

  /**
   * 写出元素起始标签、属性和结束标签（或自闭合）。
   * @param writer 写入函数
   */
  public write(writer: (chunk: string) => void): void {
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
    } else {
      this._addChildren(writer);
    }
  }

  /**
   * 写出包含子节点的闭合部分（已进行文本转义）。
   */
  protected _addChildren(writer: (chunk: string) => void): void {
    writer(">");
    for (const child of this._childNodes) {
      if (child != null) {
        if (child instanceof XMPPElement) {
          child.write(writer);
        } else if (typeof child === "string") {
          writer(escapeXMLText(child));
        } else {
          // 兜底：非字符串/非元素子节点按字符串写出，避免静默丢数据
          writer(escapeXMLText(String(child)));
        }
      }
    }
    writer("</");
    writer(this.tagName);
    writer(">");
  }
}
