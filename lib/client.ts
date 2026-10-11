import Connection from "./connection";
import { JID } from "./JID";
import { pluginLoaders } from "./plugins";
import { Options } from "./types";
import { Message, MsgType } from "@/stanza";
import { TimeoutError } from "./errors";
export class Client extends Connection {
  constructor(jid: string, password: string, options?: Options) {
    super(jid, password, options);
  }


  /**
   * 注册默认插件
   */
  registerDefaultPlugins() {
    for (const plugin of Object.keys(pluginLoaders)) {
      super.registerPlugin(plugin as keyof typeof pluginLoaders);
    }
  }

  /**
   * 发送消息
   * @param to - 接收方的 JID 或字符串
   * @param body - 消息内容
   * @param type - 消息类型，默认为 "normal"
   */
  sendMsg(to: JID | string, body: string, type: MsgType = "normal") {
    const msg = Message.createMessage(to, body, type);
    this.send(msg);
  }

  /**
   * 异步发送消息，超时时间为 1000ms，主要用于接收可能的<error>
   * 超时视为正常情况（消息通常不会收到响应），不抛出异常
   * @param to - 接收方的 JID 或字符串
   * @param body - 消息内容
   * @param type - 消息类型，默认为 "normal"
   * @throws 仅在发送失败（非超时）时抛出异常
   */
  async postMsg(to: JID | string, body: string, type: MsgType = "normal") {
    const msg = Message.createMessage(to, body, type);
    try {
      return await this.sendAsync(msg, 1000);
    } catch (e) {
      if (e instanceof TimeoutError) return;
      throw e;
    }
  }
  
  getRoster() {
    return this.RFC6121!.getRoster();
  }

  setRoster(jid: string, name?: string, group?: string) {
    return this.RFC6121!.setRoster(jid, name, group);
  }

  removeRoster(jid: string) {
    return this.RFC6121!.removeRoster(jid);
  }

  setPresence(){
    this.send(
      '<presence>'+
        '<show>chat</show>'+
      '</presence>'
    )
  }
}
