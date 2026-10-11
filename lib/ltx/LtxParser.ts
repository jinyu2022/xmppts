import { EventEmitter } from "events";
import { unescapeXML } from "./escape.js";

// 状态常量：用于状态机区分当前解析上下文
/** 文本内容状态（在标签外）*/
const STATE_TEXT = 0;
/** 忽略注释状态（<!-- ... -->）*/
const STATE_IGNORE_COMMENT = 1;
/** 忽略处理指令状态（<? ... ?>）*/
const STATE_IGNORE_INSTRUCTION = 2;
/** 正在读取标签名或特殊标记状态（如CDATA、注释）*/
const STATE_TAG_NAME = 3;
/** 在标签内部状态（属性名/自闭合处理等）*/
const STATE_TAG = 4;
/** 正在读取属性名状态 */
const STATE_ATTR_NAME = 5;
/** 等待属性等号状态（=）*/
const STATE_ATTR_EQ = 6;
/** 等待属性值引号状态（" 或 '）*/
const STATE_ATTR_QUOT = 7;
/** 正在读取属性值状态 */
const STATE_ATTR_VALUE = 8;
/** CDATA 内容状态 */
const STATE_CDATA = 9;
// const STATE_IGNORE_CDATA = 10; // 原始代码中未使用，此处省略
/**
 * LtxParser 事件类型映射定义
 */
interface LtxParserEvents {
  /** 开始标签事件 */
  startElement: [tagName: string, attrs: Record<string, string>];
  /** 结束标签事件 */
  endElement: [tagName: string, selfClosing: boolean];
  /** 文本内容事件 */
  text: [content: string];
  /** 错误事件 */
  error: [error: Error];
}

// 声明合并以支持类型安全的事件监听和触发
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface LtxParser {
  on<K extends keyof LtxParserEvents>(
    event: K, listener: (...args: LtxParserEvents[K]) => void
  ): this;
  emit<K extends keyof LtxParserEvents>(
    event: K, ...args: LtxParserEvents[K]
  ): boolean;
}
/**
 * LtxParser 类：基于状态机的流式 XML 解析器（SAX-like）。
 * 继承自 EventEmitter，触发 'startElement', 'endElement', 'text', 'error' 事件。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class LtxParser extends EventEmitter {
  private state: number = STATE_TEXT;
  private remainder: string | null = null;
  private parseRemainder: boolean = false;
  private tagName: string | undefined;
  private attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  private endTag: boolean | undefined;
  private selfClosing: boolean | undefined;
  private attrQuote: number | undefined;
  private attrQuoteChar: string | undefined;
  private recordStart: number | undefined = 0;
  private attrName: string | undefined;

  constructor() {
    super();
    // 绑定 write 方法，以便在 end() 中可以安全地调用
    this.write = this.write.bind(this);
  }

  /**
   * 处理打开/关闭标签并触发对应事件。
   */
  private _handleTagOpening(endTag: boolean | undefined, tagName: string | undefined, attrs: Record<string, string>) {
    if (!tagName) return;

    if (!endTag) {
      // 遇到开始标签 -> 触发 startElement
      this.emit("startElement", tagName, attrs);
      // 若为自闭合标签，同时触发 endElement
      if (this.selfClosing) {
        this.emit("endElement", tagName, true);
      }
    } else {
      // 结束标签 -> 触发 endElement（非自闭合）
      this.emit("endElement", tagName, false);
    }
  }

  /**
   * 向底层解析器写入数据（流式解析）。
   */
  public write(data: string | Buffer): void {
    let strData = data;
    if (typeof strData !== "string") {
      strData = data.toString();
    }

    let pos = 0;
    let currentData = strData;

    /* 处理上次留下的未完成数据片段 */
    if (this.remainder) {
      currentData = this.remainder + currentData;
      pos += !this.parseRemainder ? this.remainder.length : 0;
      this.parseRemainder = false;
      this.remainder = null;
    }

    // 辅助函数：截取 recordStart 到当前 pos 的文本并重置 recordStart
    const endRecording = (): string | undefined => {
      if (typeof this.recordStart === "number") {
        const recorded = currentData.slice(this.recordStart, pos);
        this.recordStart = undefined;
        return recorded;
      }
      return undefined;
    };

    scan: for (; pos < currentData.length; pos++) {
      // 利用 indexOf 快速跳过不必要的字符（性能优化）
      switch (this.state) {
        case STATE_TEXT: {
          // 文本状态：跳到下一个 '<'（标签开始）
          const lt = currentData.indexOf("<", pos);
          // 块内已无 '<' 则无需继续扫描
          if (lt === -1) break scan;
          if (pos !== lt) pos = lt;
          break;
        }
        case STATE_ATTR_VALUE: {
          // 属性值状态：跳到下一个结束引号
          if (this.attrQuoteChar) {
            const quot = currentData.indexOf(this.attrQuoteChar, pos);
            if (quot !== -1) {
              pos = quot;
            } else {
              // 块内无结束引号：结束本块扫描，未完成的值由 remainder 保留（引号为单字符，不会跨块切开）
              break scan;
            }
          }
          break;
        }
        case STATE_IGNORE_COMMENT: {
          // 注释状态：跳到 '-->' 结尾
          const endcomment = currentData.indexOf("-->", pos);
          if (endcomment !== -1) {
            pos = endcomment + 2; // 指向 '>' 字符
          } else {
            // 块内无注释结束符：结束本块扫描，注释内容本就丢弃，继续逐字符推进只会反复重扫块尾
            break scan;
          }
          break;
        }
        case STATE_CDATA: {
          // CDATA 状态：跳到 ']]>' 结尾
          const endCDATA = currentData.indexOf("]]>", pos);
          if (endCDATA !== -1) {
            pos = endCDATA; // 指向 ']' 字符
          } else if (currentData.endsWith("]")) {
            // 块尾是 ']'：可能是跨块 ']]>' 的前缀，定位到该字符交由下方逻辑置 parseRemainder 保留
            pos = currentData.length - 1;
          } else {
            // 块内已无可能拼出 ']]>' 的字符：结束本块扫描
            break scan;
          }
          break;
        }
        // No default
      }

      const c = currentData.charCodeAt(pos);
      switch (this.state) {
        case STATE_TEXT:
          // 在文本中遇到 '<'，将之前记录的文本发出并切换到 TAG_NAME
          if (c === 60 /* < */) {
            const text = endRecording();
            if (text) {
              // 文本需要进行 XML 实体转义还原
              this.emit("text", unescapeXML(text));
            }
            this.state = STATE_TAG_NAME;
            // 记录标签名开始位置（紧随 '<' 之后）
            this.recordStart = pos + 1;
            this.attrs = Object.create(null) as Record<string, string>;
            this.endTag = false;
            this.selfClosing = false;
          }
          break;
        case STATE_CDATA:
          // CDATA 内部直接输出原始文本，直到检测到 ']]>' 结束标记
          if (c === 93 /* ] */) {
            if (currentData.slice(pos + 1, pos + 3) === "]>") {
              const cData = endRecording();
              if (cData) {
                this.emit("text", cData);
              }
              this.state = STATE_TEXT;
            } else if (currentData.length < pos + 2) {
              // 剩余数据不足，等待下一次写入继续判断
              this.parseRemainder = true;
              pos = currentData.length;
            }
          }
          break;
        case STATE_TAG_NAME:
          // 解析标签名及可能的特殊标记（CDATA、注释、处理指令等）
          if (c === 47 /* / */ && this.recordStart === pos) {
            // 以 '/' 开头 -> 结束标签（例如 </tag>）
            this.recordStart = pos + 1;
            this.endTag = true;
          } else if (c === 33 /* ! */) {
            // 可能是 CDATA 或注释
            if (currentData.slice(pos + 1, pos + 8) === "[CDATA[") {
              this.recordStart = pos + 8; // 跳过 '[CDATA['
              this.state = STATE_CDATA;
              pos += 7;
            } else if (
              currentData.length < pos + 8 &&
              "[CDATA[".startsWith(currentData.slice(pos + 1))
            ) {
              // 片段可能是 CDATA 的前半部分，等待更多数据
              this.parseRemainder = true;
              pos = currentData.length;
            } else {
              // 普通注释（<!-- ... -->）
              this.recordStart = undefined;
              this.state = STATE_IGNORE_COMMENT;
            }
          } else if (c === 63 /* ? */) {
            // 处理指令（<? ... ?>），忽略直到 '?>'
            this.recordStart = undefined;
            this.state = STATE_IGNORE_INSTRUCTION;
          } else if (c <= 32 || c === 47 /* / */ || c === 62 /* > */) {
            // 标签名结束
            this.tagName = endRecording();
            pos--;
            this.state = STATE_TAG;
          }
          break;
        case STATE_IGNORE_COMMENT:
          // 注释结束检测：以 '-->' 结尾时回到文本状态
          if (c === 62 /* > */) {
            const prevFirst = currentData.charCodeAt(pos - 1);
            const prevSecond = currentData.charCodeAt(pos - 2);
            if (prevFirst === 45 /* - */ && prevSecond === 45 /* - */) {
              this.state = STATE_TEXT;
              this.recordStart = pos + 1;
            }
          }
          break;
        case STATE_IGNORE_INSTRUCTION:
          // 处理指令以 '?>' 结尾，返回文本状态
          if (c === 62 /* > */) {
            const prev = currentData.charCodeAt(pos - 1);
            if (prev === 63 /* ? */) {
              this.state = STATE_TEXT;
              this.recordStart = pos + 1;
            }
          }
          break;
        case STATE_TAG:
          // 标签体处理：遇 '>' 表示标签结束并触发事件；遇 '/' 表示自闭合；遇属性字符则转到属性名状态
          if (c === 62 /* > */) {
            this._handleTagOpening(this.endTag, this.tagName, this.attrs);
            // 重置与准备下一次
            this.tagName = undefined;
            this.attrs = Object.create(null) as Record<string, string>;
            this.endTag = undefined;
            this.selfClosing = undefined;
            this.state = STATE_TEXT;
            this.recordStart = pos + 1;
          } else if (c === 47 /* / */) {
            this.selfClosing = true;
          } else if (c > 32 /* 非空白字符 */) {
            // 属性名开始
            this.recordStart = pos;
            this.state = STATE_ATTR_NAME;
          }
          break;
        case STATE_ATTR_NAME:
          // 属性名解析结束（遇到空白或 '='）
          if (c <= 32 || c === 61 /* = */) {
            this.attrName = endRecording();
            pos--;
            this.state = STATE_ATTR_EQ;
          }
          break;
        case STATE_ATTR_EQ:
          // 等号检测，准备读取属性值
          if (c === 61 /* = */) {
            this.state = STATE_ATTR_QUOT;
          }
          break;
        case STATE_ATTR_QUOT:
          // 期待引号开始属性值，记录引号类型
          if (c === 34 /* " */ || c === 39 /* ' */) {
            this.attrQuote = c;
            this.attrQuoteChar = c === 34 ? '"' : "'";
            this.state = STATE_ATTR_VALUE;
            this.recordStart = pos + 1;
          }
          break;
        case STATE_ATTR_VALUE:
          // 属性值结束，解析并存入 attrs 对象
          if (c === this.attrQuote) {
            const value = endRecording();
            if (this.attrName && value !== undefined) {
              // 属性值需要进行 XML 实体转义还原
              this.attrs[this.attrName] = unescapeXML(value);
            }
            this.attrName = undefined;
            this.state = STATE_TAG;
          }
          break;
      }
    }

    // 若还有未完成的记录片段，则保存为 remainder 以供下一次 write 使用
    if (typeof this.recordStart === "number" && this.recordStart <= currentData.length) {
      this.remainder = currentData.slice(this.recordStart);
      this.recordStart = 0;
    }
  }

  /**
   * 结束输入并在没有错误时根据解析结果触发 'tree' 或 'error'。
   */
  public end(data?: string | Buffer): void {
    // 可选地在结束时写入剩余数据
    if (data) {
      this.write(data);
    }

    // 如果在 STATE_TEXT 状态下有剩余文本，将其作为最后一个文本节点发出
    if (this.state === STATE_TEXT && this.remainder) {
      this.emit("text", unescapeXML(this.remainder));
      this.remainder = null;
    }

    /* 禁用后续写入（解析结束） */
    this.write = function write() {};
  }
}
