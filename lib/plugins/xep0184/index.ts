import { MessageReceipts } from "./messageReceipts";
import type Connection from "@/connection";
import type { Plugin } from "../types";
import { Message } from "@/stanza";

/**
 * XEP-0184 插件配置
 */
export interface XEP0184Options {
  /** 是否自动为待发送消息附加回执请求，默认 `true` */
  autoRequest?: boolean;
}
/**
 * XEP-0184: Message Receipts
 * @see https://xmpp.org/extensions/xep-0184.html
 * @version 1.4.0 (2018-08-02)
 *
 * 1. 客户端发送消息时，会自动添加回执请求
 * 2. 客户端接收到消息时，会自动处理回执请求
 */
export default class XEP0184 extends MessageReceipts implements Plugin {
  static readonly dependencies = ["XEP0030"] as const;

  /** XMPP连接实例 */
  private readonly connection: Connection;
  /** 是否自动为待发送消息附加回执请求 */
  private readonly autoRequest: boolean;
  constructor(connection: Connection, options?: XEP0184Options) {
    super();
    this.connection = connection;
    //默认开启
    this.autoRequest = options?.autoRequest ?? true;
  }
  init() {
    this.connection.XEP0030!.addFeature(MessageReceipts.NS);
    this.connection.registerStanzaPlugin(
      MessageReceipts.NS,
      XEP0184.parseReceipts,
    );
    // 拦截发送消息，添加回执请求；未启用自动请求时不注册中间件
    if (this.autoRequest) {
      this.connection.pipeline.use("send", (ctx, next) => {
        const stanza = ctx.stanza;
        if (
          stanza.tagName === "message" &&
          // 聊天室中发送 “groupchat” 类型的内容消息时，不建议请求回执
          stanza.getAttribute("type") !== "groupchat" &&
          stanza.getAttribute("type") !== "error" &&
          // 只看直接子元素：递归查找会把 <forwarded><message><body> 的内层 body 也算进来
          stanza.querySelector(":scope > body") &&
          // §5.4：已携带 <received/> 的是回执应答，不能再请求回执，否则两端会来回应答。
          // 本端构造的元素由 createElementNS 写入 xmlns 属性，按属性筛选即可限定命名空间
          !stanza.querySelector(`:scope > received[xmlns="${MessageReceipts.NS}"]`)
          // TODO: 检查对方是否支持回执，若不支持则不附加 request
        ) {
          stanza.appendChild(XEP0184.createReceiptsEl("request"));
        }
        return next();
      });
    }
    // 接收消息，处理回执请求
    this.connection.on("message", (message) => {
      /**
       * 聊天室中发送 “groupchat” 类型的内容消息时，不建议请求回执
       * @see https://xmpp.org/extensions/xep-0184.html#when-groupchat
       * */
      if (
        message.receipts?.type === "request" &&
        message.type !== "groupchat" &&
        message.type !== "error"
      ) {
        const id = message.id!;
        const received = XEP0184.createReceiptsEl("received", id);
        const msg = Message.createMessage(
          message.from.toString(),
          "",
          message.type,
        );
        msg.appendChild(received);
        this.connection.send(msg);
      }
    });
  }
}
