import { MessageReceipts } from "./messageReceipts";
import type Connection from "@/connection";
import type { Plugin } from "../types";
import { Message } from "@/stanza";
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
  readonly connection: Connection;
  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }
  init() {
    this.connection.XEP0030!.addFeature(MessageReceipts.NS);
    this.connection.registerStanzaPlugin(
      MessageReceipts.NS,
      XEP0184.parseReceipts,
    );
    // 拦截发送消息，添加回执请求
    this.connection.pipeline.use("send", (ctx, next) => {
      const stanza = ctx.stanza;
      if (
        stanza.tagName === "message" &&
        // 聊天室中发送 “groupchat” 类型的内容消息时，不建议请求回执
        stanza.getAttribute("type") !== "groupchat" &&
        stanza.getAttribute("type") !== "error" &&
        stanza.getElementsByTagName("body").length &&
        // 幂等守卫，避免重复添加回执请求
        !stanza.getElementsByTagNameNS(MessageReceipts.NS, "request").length
        // TODO: 检查对方是否支持回执，若不支持则不附加 request
      ) {
        stanza.appendChild(XEP0184.createReceiptsEl("request"));
      }
      return next();
    });
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
