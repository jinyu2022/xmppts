import { EventEmitter } from "events";
import { XMPPElement } from "./Element.js";
import { LtxParser } from "./LtxParser.js";


interface ParserEvents {
  /** 当解析到完整的 Element 树时触发 */
  tree: [tree: XMPPElement];
  /** 当解析过程中发生错误时触发 */
  error: [error: Error];
  /** 流开始标记（收到对端的 <stream:stream ...>）：载荷为流头元素，可读 from/id/version */
  streamStart: [header: XMPPElement];
  /** 流结束标记（</stream:stream>）：对端关闭流，负责触发本端关闭 */
  streamEnd: [];
  /** 当遇到开始标签时触发 */
  startElement: [name: string, attrs: Record<string, string>];
  /** 当遇到结束标签时触发 */
  endElement: [name: string, selfClosing: boolean];
}
// 扩展 EventEmitter 类型定义
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Parser {
  on<K extends keyof ParserEvents>(
    event: K,
    listener: (...args: ParserEvents[K]) => void
  ): this;
  emit<K extends keyof ParserEvents>(
    event: K,
    ...args: ParserEvents[K]
  ): boolean;
}

/**
 * 基于 LtxParser 的 XML 解析器，构建 XMPPElement 树。
 * emit 事件：
 * - 'tree': 解析完成时触发，传递根 Element。
 * - 'error': 解析错误时触发，传递 Error 对象。
 * - 'streamStart': 收到对端流头（<stream:stream ...>）时触发，传递流头元素。
 * - 'streamEnd': 解析到流结束标记（</stream:stream>）时触发，对端关闭流的信号。
 * - 'startElement': 遇到开始标签时触发，传递标签名和属性。
 * - 'endElement': 遇到结束标签时触发，传递标签名和是否自闭合。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Parser extends EventEmitter {
  public tree: XMPPElement | null = null;
  public error: Error | null = null;
  private parser?: LtxParser;
  private currentElement: XMPPElement | null = null;
  /** 流头元素：不进树，仅作为顶层元素的 xmlns 解析上下文 */
  private streamRoot: XMPPElement | null = null;

  constructor() {
    super();
    this._setupParser();
  }

  /**
   * 初始化底层解析器并设置所有事件监听器。
   */
  private _setupParser(): void {
    // 创建底层解析器实例
    this.parser = new LtxParser();

    // startElement: 当遇到开始标签时创建一个新的 Element 实例
    this.parser.on("startElement", (name: string, attrs: Record<string, string>) => {
      this.emit("startElement", name, attrs);
      // 创建节点
      const child = XMPPElement.createElement(name, attrs);
      // 【XMPP流式处理】流头不进树：后续 Stanza 因此各自成为顶层元素，闭合时触发 'tree'。
      // 但必须保留它作为顶层元素的 xmlns 解析上下文，否则继承自流头的命名空间解析不出来。
      if (!this.currentElement && name === "stream:stream") {
        this.streamRoot = child;
        this.emit("streamStart", child);
        return;
      }
      // 如果当前没有根节点，则 child 成为根；否则将 child 连接为当前节点的子节点
      this.currentElement = this.currentElement ? this.currentElement.appendChild(child) : child;
    });

    // endElement: 当遇到结束标签时，按层级回退或完成整棵树
    this.parser.on("endElement", (name: string, selfClosing: boolean) => {
      if (!this.currentElement) {
        // 【XMPP流式处理】闭合的流头（</stream:stream>）是流结束标记：
        // 上报 streamEnd 供连接层完成关闭，不能静默吞掉（流尾负责关闭）
        if (name === "stream:stream") {
          this.emit("streamEnd");
          return;
        }
        // 无当前元素但收到了结束标签（不一致的文档）
        this.error = new Error(`Unexpected end tag: ${name}`);
        this.emit("error", this.error);
        return;
      }

      if (name === this.currentElement.tagName) {
        // 如果有父节点，回退到父节点；否则说明该节点可能是根节点
        if (this.currentElement.parentNode) {
          this.currentElement = this.currentElement.parentNode;
        } else {
          // 根节点完全闭合，保存为最终树并清空当前节点
          this.tree = this.currentElement;
          // 挂上流头作为 xmlns 上下文（顶层元素本身不进流头的 childNodes）
          this.currentElement._setParentNode(this.streamRoot);
          this.emit("tree", this.tree);
          this.currentElement = null;
        }
        this.emit("endElement", name, selfClosing);
      } else if (!selfClosing) {
        // 结束标签与当前元素名称不匹配（非自闭合标签）
        this.error = new Error(`Mismatched end tag: expected ${this.currentElement.tagName}, got ${name}`);
        this.emit("error", this.error);
      }
      // 如果是自闭合标签，el 已经在 startElement 中回退，无需额外处理
    });

    // text: 文本事件将内容追加到当前元素
    this.parser.on("text", (str: string) => {
      if (this.currentElement) {
        this.currentElement.append(str);
      }
    });

    // error: 底层解析器发生错误时，记录并向外部转发 error 事件
    this.parser.on("error", (e: Error) => {
      this.error = e;
      this.emit("error", e);
    });
  }

  /**
   * 重置解析器状态，以便可以解析新的 XML 文档。
   */
  public reset(): void {
    this.tree = null;
    this.error = null;
    this.currentElement = null;
    // 流重启后会有新的流头，旧的命名空间上下文必须丢弃
    this.streamRoot = null;
    // 移除旧解析器的所有监听器，并创建一个新的 LtxParser 实例
    this.parser!.removeAllListeners();
    this._setupParser();
  }

  /**
   * write: 向底层解析器写入数据（流式解析）。
   */
  public write(data: string | Buffer): void {
    if (this.error) return;
    this.parser!.write(data);
  }

  /**
   * end: 结束输入并在没有错误时根据解析结果触发 'tree' 或 'error'。
   */
  public end(data?: string | Buffer): void {
    if (this.error) return;

    this.parser!.end(data);

    if (!this.error) {
      if (this.tree) {
        // 解析成功，发送完整的解析树
        this.emit("tree", this.tree);
      } else {
        // 输入结束但未生成完整树（例如文档不完整），触发错误
        this.error = new Error("Incomplete document");
        this.emit("error", this.error);
      }
    }
  }

  /**
   * 同步解析 XML 字符串或 Buffer。
   * @param data 待解析的 XML 字符串或 Buffer。
   * @returns 解析后的 Element 树。
   */
  public static parse(data: string | Buffer): XMPPElement {
    // 允许传入一个自定义的 Parser 构造函数作为 options
    const p = new Parser();
    // 两者只在下面的回调里赋值，初始化器用于消除「使用前未赋值」检查
    let result: XMPPElement | null = null;
    let error: Error | null = null;

    p.on("tree", (tree: XMPPElement) => {
      result = tree;
    });
    p.on("error", (e: Error) => {
      error = e;
    });

    p.write(data);
    p.end();

    if (error != null) {
      // TS 把 error 收窄成 null（闭包内赋值不可见），此处断言回声明的 Error 类型
      throw error as Error;
    } else if (result) {
      return result;
    } else {
      // 理论上 end() 应该在没有 tree 时抛出 "Incomplete document" 错误，
      // 但为了安全起见，此处也抛出错误。
      throw new Error("Parsing failed to produce a document tree.");
    }
  }
}
