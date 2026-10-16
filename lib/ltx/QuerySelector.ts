import { XMPPElement } from "./Element.js";

/** 组合符：该复合选择器与前一个的关系 */
type Combinator = " " | ">" | "+" | "~";

/** 单个属性选择器：[name] 或 [name op value]（解析期预编译匹配方式） */
interface AttributeSelector {
  name: string;
  operator?: "=" | "~=" | "|=" | "^=" | "$=" | "*=";
  value?: string;
  /** `~=`/`|=`/`^=`/`$=`/`*=` 预编译的正则；`=` 与仅存在性检查为 undefined */
  regExp?: RegExp;
  /** 规范：非 `=` 操作符的期望值为空串时，该选择器不代表任何元素 */
  never?: boolean;
}

/** 单个复合选择器（解析期预编译；combinator 表示与上一个的关系） */
interface SelectorItem {
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: AttributeSelector[];
  scope: boolean;
  combinator: Combinator;
}

/**
 * XMPPElement 的选择器查询工具。
 *
 * 支持：类型/`*`、`#id`、`.class`、`[attr]`、`[attr op value]`（`= ~= |= ^= $= *=`，
 * 值可加引号，`ns|attr` 等价 `ns:attr`）、后代（空格）/子代（`>`）/相邻兄弟（`+`）/
 * 后续兄弟（`~`）组合、逗号分隔的选择器列表；标识符支持 `\x` 转义。
 * `:` 一律按伪类解析（`stream:features` 拆为标签 `stream` + 伪类 `features`），
 * 带前缀标签写作 `stream|features` / `stream\:features` / `*|features`；
 * `ns|*` 按前缀匹配 tagName，其余含 `:` 者按 tagName 精确匹配，无 `:` 者按 `localName`。
 * 伪类仅支持 `:scope`（大小写不敏感），作为查询起点锚点用于支持直接子元素查询；
 * 其余伪类/伪元素（`:not(...)`、`::text` 等）按非法选择器抛 SyntaxError。
 *
 * @class QuerySelector
 */
export default class QuerySelector {
  /** selector 文本 → 解析结果缓存（仅语法层，无失效问题；键来自代码，量级有限） */
  private static readonly parseCache = new Map<string, SelectorItem[][]>();

  /**
   * 查找与选择器匹配的第一个后代元素（前序，不含 node 自身）。
   *
   * 前序 DFS 命中即返回：CSS 规定取文档序最前的匹配元素，前序天然满足。
   * @param node 查找起点。
   * @param selector CSS 选择器。
   * @returns 匹配的元素，无匹配返回 null。
   */
  public static querySelector(
    node: XMPPElement,
    selector: string,
  ): XMPPElement | null {
    const groups = this.parse(selector, "querySelector");
    const stack: XMPPElement[] = [];
    this.pushChildren(stack, node);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const group of groups) {
        if (this.matchesSelector(current, group, node, group.length - 1)) {
          return current;
        }
      }
      this.pushChildren(stack, current);
    }
    return null;
  }

  /**
   * 查找与选择器匹配的所有后代元素（前序，不含 node 自身）。
   * @param node 查找起点。
   * @param selector CSS 选择器。
   * @returns 匹配的元素数组。
   */
  public static querySelectorAll(
    node: XMPPElement,
    selector: string,
  ): XMPPElement[] {
    const groups = this.parse(selector, "querySelectorAll");
    const found = new Set<XMPPElement>();
    for (const group of groups) {
      // 起点自身也参与匹配（`:scope` 与组合符需要），输出时再排除
      this.findAll([node], node, group, 0, found);
    }
    if (found.size === 0) {
      return [];
    }
    // 按文档序输出
    const result: XMPPElement[] = [];
    const stack: XMPPElement[] = [];
    this.pushChildren(stack, node);
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (found.has(current)) {
        result.push(current);
      }
      this.pushChildren(stack, current);
    }
    return result;
  }

  /**
   * 目标元素自身是否匹配选择器（组合符会沿兄弟/祖先链判断）。
   * @param element 目标元素。
   * @param selector CSS 选择器。
   * @returns 是否匹配。
   */
  public static matches(element: XMPPElement, selector: string): boolean {
    const groups = this.parse(selector, "matches");
    return groups.some((group) =>
      this.matchesSelector(element, group, element, group.length - 1),
    );
  }

  /** 校验并解析选择器为选择器组列表（命中缓存则跳过解析） */
  private static parse(selector: string, method: string): SelectorItem[][] {
    const value = String(selector);
    if (!value.trim()) {
      throw new DOMException(
        `Failed to execute '${method}' on 'XMPPElement': The provided selector is empty.`,
        "SyntaxError",
      );
    }
    const cached = this.parseCache.get(value);
    if (cached) {
      return cached;
    }
    const groups = this.parseSelectorList(value, method);
    if (this.parseCache.size >= 1000) {
      this.parseCache.clear();
    }
    this.parseCache.set(value, groups);
    return groups;
  }

  /**
   * 正向推进收集（对齐 happy-dom 的 findAll）：只有命中当前步的元素才进入下一步，
   * 失配的前缀不会展开，因此不产生后代组合符的组合爆炸。
   * @param nodes 本层待扫描的子节点原始列表（文本节点会被跳过）
   * @param root 查询起点（结果排除其自身，亦作为 `:scope` 锚点）
   * @param items 选择器组（自左向右）
   * @param itemIndex 本层对应 items 的下标（递归时 +1，避免切片分配）
   * @param found 结果集合（天然去重）
   */
  private static findAll(
    nodes: readonly (XMPPElement | string)[],
    root: XMPPElement,
    items: readonly SelectorItem[],
    itemIndex: number,
    found: Set<XMPPElement>,
  ): void {
    const item = items[itemIndex];
    const next = items[itemIndex + 1];
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (!(child instanceof XMPPElement)) {
        continue;
      }
      if (this.matchesItem(child, item, root)) {
        if (!next) {
          if (child !== root) {
            found.add(child);
          }
        } else {
          switch (next.combinator) {
            case "+": {
              const sibling = child.nextElementSibling;
              if (sibling) {
                this.findAll([sibling], root, items, itemIndex + 1, found);
              }
              break;
            }
            case "~": {
              const siblings: XMPPElement[] = [];
              for (
                let sibling = child.nextElementSibling;
                sibling;
                sibling = sibling.nextElementSibling
              ) {
                siblings.push(sibling);
              }
              if (siblings.length > 0) {
                this.findAll(siblings, root, items, itemIndex + 1, found);
              }
              break;
            }
            default:
              // 后代（空格）与子代（`>`）的下一步都在直接子节点里找
              this.findAll(child.childNodes, root, items, itemIndex + 1, found);
          }
        }
      }
      // 后代轴续探：当前项与更浅层是后代关系（或无组合符）时，同一步可继续向深层匹配
      if (item.combinator === " ") {
        const descendants = child.childNodes;
        if (descendants.length > 0) {
          this.findAll(descendants, root, items, itemIndex, found);
        }
      }
    }
  }

  /** 按文档顺序将元素子节点倒序压栈 */
  private static pushChildren(stack: XMPPElement[], node: XMPPElement): void {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child instanceof XMPPElement) {
        stack.push(child);
      }
    }
  }

  /** 保留转义空白，仅移除选择器片段边界空白 */
  private static trimSelectorSegment(source: string): string {
    let end = source.length;
    while (end > 0 && /\s/.test(source[end - 1])) {
      let slashCount = 0;
      for (let i = end - 2; i >= 0 && source[i] === "\\"; i--) {
        slashCount++;
      }
      if (slashCount % 2 === 1) {
        break;
      }
      end--;
    }
    return source.slice(0, end).trimStart();
  }

  /** 构造非法选择器错误 */
  private static invalidSelector(
    method: string,
    selector: string,
  ): DOMException {
    return new DOMException(
      `Failed to execute '${method}' on 'XMPPElement': '${selector}' is not a valid selector.`,
      "SyntaxError",
    );
  }

  /**
   * 扫描选择器文本：组合符 / 逗号仅在方括号 / 括号 / 引号之外生效，
   * 按记号切出片段交给 parseItem 解析。
   */
  private static parseSelectorList(
    selector: string,
    method: string,
  ): SelectorItem[][] {
    const groups: SelectorItem[][] = [];
    let steps: SelectorItem[] = [];
    let combinator: Combinator = " ";
    let lastIndex = 0;
    let brackets = 0;
    let parens = 0;
    let quote: string | null = null;
    let escaped = false;

    const flush = (endIndex: number): void => {
      const source = this.trimSelectorSegment(
        selector.slice(lastIndex, endIndex),
      );
      if (!source) {
        return;
      }
      if (steps.length === 0 && combinator !== " ") {
        throw this.invalidSelector(method, selector);
      }
      steps.push(this.parseItem(source, combinator, method, selector));
      combinator = " ";
    };

    for (let i = 0; i < selector.length; ) {
      const char = selector[i];
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        i++;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = null;
        }
        i++;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        i++;
        continue;
      }
      if (char === "[") {
        brackets++;
        i++;
        continue;
      }
      if (char === "]") {
        brackets--;
        i++;
        continue;
      }
      if (char === "(") {
        parens++;
        i++;
        continue;
      }
      if (char === ")") {
        parens--;
        i++;
        continue;
      }
      if (brackets === 0 && parens === 0) {
        if (/\s/.test(char)) {
          const start = i;
          do {
            i++;
          } while (i < selector.length && /\s/.test(selector[i]));
          flush(start);
          lastIndex = i;
          continue;
        }
        if (char === ",") {
          if (combinator !== " ") {
            throw this.invalidSelector(method, selector);
          }
          flush(i);
          if (steps.length === 0) {
            throw this.invalidSelector(method, selector);
          }
          groups.push(steps);
          steps = [];
          combinator = " ";
          lastIndex = ++i;
          continue;
        }
        if ("+>~".includes(char)) {
          if (steps.length === 0 || combinator !== " ") {
            throw this.invalidSelector(method, selector);
          }
          flush(i);
          combinator = char as Combinator;
          lastIndex = ++i;
          continue;
        }
      }
      i++;
    }
    flush(selector.length);

    if (
      escaped ||
      quote ||
      brackets !== 0 ||
      parens !== 0 ||
      combinator !== " " ||
      steps.length === 0
    ) {
      throw this.invalidSelector(method, selector);
    }
    groups.push(steps);
    return groups;
  }

  /** 解析单个复合选择器（类型 / `*` / `#id` / `.class` / `[attr...]` / 伪类） */
  private static parseItem(
    source: string,
    combinator: Combinator,
    method: string,
    selector: string,
  ): SelectorItem {
    const compound: SelectorItem = {
      tag: null,
      id: null,
      classes: [],
      attributes: [],
      scope: false,
      combinator,
    };
    let i = 0;
    let hasTypeSelector = false;
    let hasNamespaceSeparator = false;

    while (i < source.length) {
      const char = source[i];
      if (char === "*") {
        if (hasTypeSelector || hasNamespaceSeparator) {
          throw this.invalidSelector(method, selector);
        }
        compound.tag = "*";
        hasTypeSelector = true;
        i++;
      } else if (char === "#" || char === ".") {
        i++;
        const { value, index } = this.readIdentifier(source, i);
        if (!value) {
          throw this.invalidSelector(method, selector);
        }
        if (char === "#") {
          compound.id = value;
        } else {
          compound.classes.push(value);
        }
        i = index;
      } else if (char === "[") {
        i = this.parseAttributeSelector(source, i, compound, method, selector);
      } else if (char === ":") {
        i++;
        const isPseudoElement = source[i] === ":";
        if (isPseudoElement) {
          i++;
        }
        const { value: name, index } = this.readIdentifier(source, i);
        i = index;
        if (isPseudoElement || name.toLowerCase() !== "scope") {
          throw this.invalidSelector(method, selector);
        }
        compound.scope = true;
      } else if (char === "|") {
        // `ns|tag` / `*|tag` 命名空间写法（`|tag` 按 localName，`a|*` 按前缀）
        if (hasNamespaceSeparator) {
          throw this.invalidSelector(method, selector);
        }
        hasNamespaceSeparator = true;
        i++;
        if (source[i] === "*") {
          compound.tag =
            compound.tag && compound.tag !== "*" ? `${compound.tag}:*` : "*";
          i++;
        } else {
          const { value, index } = this.readIdentifier(source, i);
          if (!value) {
            throw this.invalidSelector(method, selector);
          }
          compound.tag =
            compound.tag && compound.tag !== "*"
              ? `${compound.tag}:${value}`
              : value;
          i = index;
        }
      } else {
        if (hasTypeSelector) {
          throw this.invalidSelector(method, selector);
        }
        const { value, index } = this.readIdentifier(source, i);
        if (!value) {
          throw this.invalidSelector(method, selector);
        }
        compound.tag = value;
        hasTypeSelector = true;
        i = index;
      }
    }

    return compound;
  }

  /** 从 start 处读取标识符（允许 `\x` 转义）；返回解码值与结束位置 */
  private static readIdentifier(
    source: string,
    start: number,
  ): { value: string; index: number } {
    const identifier = /[A-Za-z0-9_-]+/y;
    let value = "";
    let i = start;
    while (i < source.length) {
      const char = source[i];
      if (char === "\\" && i + 1 < source.length) {
        value += source[i + 1];
        i += 2;
        continue;
      }
      identifier.lastIndex = i;
      const match = identifier.exec(source);
      if (!match) {
        break;
      }
      value += match[0];
      i = identifier.lastIndex;
    }
    return { value, index: i };
  }

  /** 解析 `[...]` 属性选择器（i 指向 `[`），返回 `]` 之后的位置 */
  private static parseAttributeSelector(
    source: string,
    start: number,
    compound: SelectorItem,
    method: string,
    selector: string,
  ): number {
    // 属性名片段：比标识符多允许 `:`
    const attributeName = /[A-Za-z0-9_:-]+/y;
    const spaces = /[ \t\r\n]+/y;
    const skipSpaces = (pos: number): number => {
      spaces.lastIndex = pos;
      return spaces.exec(source) ? spaces.lastIndex : pos;
    };

    let i = skipSpaces(start + 1);

    let name = "";
    while (i < source.length) {
      const char = source[i];
      if (char === "\\" && i + 1 < source.length) {
        name += source[i + 1];
        i += 2;
        continue;
      }
      attributeName.lastIndex = i;
      const match = attributeName.exec(source);
      if (match) {
        name += match[0];
        i = attributeName.lastIndex;
        continue;
      }
      if (char === "|" && source[i + 1] !== "=") {
        // `[ns|attr]` 归一化为属性名 `ns:attr`
        name += ":";
        i++;
        continue;
      }
      break;
    }
    if (!name) {
      throw this.invalidSelector(method, selector);
    }

    i = skipSpaces(i);
    let operator: AttributeSelector["operator"];
    if ("~|^$*".includes(source[i]) && source[i + 1] === "=") {
      operator = (source[i] + "=") as AttributeSelector["operator"];
      i += 2;
    } else if (source[i] === "=") {
      operator = "=";
      i++;
    }

    let value: string | undefined;
    if (operator) {
      i = skipSpaces(i);
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        i++;
        let parsedValue = "";
        while (i < source.length) {
          if (source[i] === "\\" && i + 1 < source.length) {
            parsedValue += source[i + 1];
            i += 2;
          } else if (source[i] === quote) {
            break;
          } else {
            parsedValue += source[i++];
          }
        }
        if (source[i] !== quote) {
          throw this.invalidSelector(method, selector);
        }
        value = parsedValue;
        i++;
      } else {
        let parsedValue = "";
        let escapedTrailingSpace = false;
        while (i < source.length) {
          if (source[i] === "\\" && i + 1 < source.length) {
            const escaped = source[i + 1];
            parsedValue += escaped;
            escapedTrailingSpace = /\s/.test(escaped);
            i += 2;
          } else if (source[i] === "]") {
            break;
          } else {
            parsedValue += source[i++];
            escapedTrailingSpace = false;
          }
        }
        value = escapedTrailingSpace
          ? parsedValue.trimStart()
          : parsedValue.trim();
        if (!value) {
          throw this.invalidSelector(method, selector);
        }
      }
    }

    i = skipSpaces(i);
    if (source[i] !== "]") {
      throw this.invalidSelector(method, selector);
    }
    // 非 `=` 操作符的期望值为空串时，规范规定其不代表任何元素
    const never = operator !== undefined && operator !== "=" && value === "";
    compound.attributes.push({
      name,
      operator,
      value,
      regExp:
        operator && value ? this.buildAttributeRegExp(operator, value) : undefined,
      never,
    });
    return i + 1;
  }

  /** 把属性操作符编译为正则（`=` 走严格相等，不建正则） */
  private static buildAttributeRegExp(
    operator: AttributeSelector["operator"],
    value: string,
  ): RegExp | undefined {
    // 转义正则特殊字符，值按字面量匹配
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    switch (operator) {
      case "~=":
        return new RegExp(`(^|\\s)${escaped}(\\s|$)`);
      case "|=":
        return new RegExp(`^${escaped}(-|$)`);
      case "^=":
        return new RegExp(`^${escaped}`);
      case "$=":
        return new RegExp(`${escaped}$`);
      case "*=":
        return new RegExp(escaped);
      default:
        return undefined;
    }
  }

  /** 元素是否匹配单个复合选择器 */
  private static matchesItem(
    el: XMPPElement,
    item: SelectorItem,
    scope: XMPPElement,
  ): boolean {
    if (item.scope && el !== scope) {
      return false;
    }
    if (item.tag && item.tag !== "*") {
      // `ns|*` 按前缀匹配，含 `:` 按 tagName，其余按 localName
      let matched: boolean;
      if (item.tag.endsWith(":*")) {
        matched = el.tagName.startsWith(item.tag.slice(0, -1));
      } else if (item.tag.includes(":")) {
        matched = el.tagName === item.tag;
      } else {
        matched = el.localName === item.tag;
      }
      if (!matched) {
        return false;
      }
    }
    if (item.id !== null && el.getAttribute("id") !== item.id) {
      return false;
    }
    if (item.classes.length > 0) {
      const classAttr = el.getAttribute("class");
      if (!classAttr) {
        return false;
      }
      const classNames = classAttr.split(/\s+/);
      for (const className of item.classes) {
        if (!classNames.includes(className)) {
          return false;
        }
      }
    }
    for (const attr of item.attributes) {
      const value = el.getAttribute(attr.name);
      if (value === null) {
        return false;
      }
      if (!attr.operator) {
        continue;
      }
      if (attr.never) {
        return false;
      }
      if (attr.regExp) {
        if (!attr.regExp.test(value)) {
          return false;
        }
      } else if (value !== (attr.value ?? "")) {
        return false;
      }
    }
    return true;
  }

  /** 自右向左匹配选择器链的第 index 步 */
  private static matchesSelector(
    el: XMPPElement,
    items: readonly SelectorItem[],
    scope: XMPPElement,
    index: number,
  ): boolean {
    const item = items[index];
    if (!item || !this.matchesItem(el, item, scope)) {
      return false;
    }
    if (index === 0) {
      return true;
    }
    switch (item.combinator) {
      case ">": {
        const parent = el.parentElement;
        return parent
          ? this.matchesSelector(parent, items, scope, index - 1)
          : false;
      }
      case "+": {
        const previous = el.previousElementSibling;
        return previous
          ? this.matchesSelector(previous, items, scope, index - 1)
          : false;
      }
      case "~": {
        for (
          let previous = el.previousElementSibling;
          previous;
          previous = previous.previousElementSibling
        ) {
          if (this.matchesSelector(previous, items, scope, index - 1)) {
            return true;
          }
        }
        return false;
      }
      default: {
        let ancestor = el.parentElement;
        while (ancestor) {
          if (this.matchesSelector(ancestor, items, scope, index - 1)) {
            return true;
          }
          ancestor = ancestor.parentElement;
        }
        return false;
      }
    }
  }
}
