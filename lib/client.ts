import Connection from "./connection";
import { JID } from "./JID";
import { pluginLoaders } from "./plugins";
import { Message, type MsgType } from "@/stanza";

export class Client extends Connection {
  /**
   * 注册默认插件
   *
   * 浏览器环境跳过依赖 Node.js 内置模块的插件（如 XEP0368 的 SRV/TLS 发现）。
   */
  registerDefaultPlugins() {
    // 浏览器打包器注入的 process 通常没有 versions.node，据此区分运行时
    const isNode =
      typeof process !== "undefined" && !!process.versions?.node;
    for (const plugin of Object.keys(pluginLoaders) as (keyof typeof pluginLoaders)[]) {
      // XEP0368 依赖 Node.js 的 DNS/TLS 发现，浏览器环境跳过
      if (!isNode && plugin === "XEP0368") continue;
      super.registerPlugin(plugin);
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
      if (e instanceof DOMException && e.name === "TimeoutError") return;
      throw e;
    }
  }
  
  getRoster() {
    return this.RFC6121!.getRoster();
  }

  setRoster(jid: string, name?: string, group?: string | string[]) {
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
