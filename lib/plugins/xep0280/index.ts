import type { Connection } from "../../connection";
import type { Message } from "../../stanza";
import type { Plugin } from "../types";
import { Carbons } from "./carbons";
import logger from "@/log";
const log = logger.getLogger("XEP0280");

/**
 * XEP-0280: Message Carbons
 * @see https://xmpp.org/extensions/xep-0280.html
 * @version 1.0.1 (2021-12-26)
 */
export class XEP0280 extends Carbons implements Plugin {
  static readonly dependencies = ["XEP0030", "XEP0297"] as const;
  readonly connection: Connection;
  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }

  init() {
    this.connection.XEP0030!.addFeature(XEP0280.NS);

    // 会话建立后才查询服务器特性
    this.connection.once("session:start", () => {
      void this.connection
        .XEP0030!.getServerFeatures()
        .then((features) => {
          if (features.has(XEP0280.NS)) return this.enable();
          log.warn("服务器不支持 XEP-0280");
        })
        .catch((error: unknown) => log.warn("获取服务器特性失败", error));
    });

    this.connection.registerStanzaPlugin(XEP0280.NS, XEP0280.parseCarbonEl);

    this.connection.registerEventPlugin("carbon:received", {
      tagName: "message",
      matcher: (message) => {
        if (message?.carbon?.type === "received") {
          if (message.from.bare !== this.connection.jid.bare) {
            log.warn(
              `收到伪造的 carbon:received 消息，from=${message.from.toString()}，应为本账号 bare JID=${this.connection.jid.bare}，已忽略`
            );
            return false;
          }
          return true;
        }
        return false;
      },
    });

    this.connection.registerEventPlugin("carbon:sent", {
      tagName: "message",
      matcher: (message) => {
        if (message?.carbon?.type === "sent") {
          if (message.from.bare !== this.connection.jid.bare) {
            log.warn(
              `收到伪造的 carbon:sent 消息，from=${message.from.toString()}，应为本账号 bare JID=${this.connection.jid.bare}，已忽略`
            );
            return false;
          }
          return true;
        }
        return false;
      },
    });
  }

  async enable(): Promise<boolean> {
    const iq = Carbons.createEnableIq();
    try {
      const result = await this.connection.sendAsync(iq);
      if (result.getAttribute("type") === "result") {
        log.debug("消息碳已启用");
        return true;
      }
      log.warn("服务器拒绝启用消息碳", result.toXMLString());
      return false;
    } catch (error) {
      log.warn("启用消息碳失败", error);
      return false;
    }
  }

  async disable(): Promise<boolean> {
    const iq = Carbons.createDisableIq();
    try {
      const result = await this.connection.sendAsync(iq);
      if (result.getAttribute("type") === "result") {
        log.debug("消息碳已禁用");
        return true;
      }
      log.warn("服务器拒绝禁用消息碳", result.toXMLString());
      return false;
    } catch (error) {
      log.warn("禁用消息碳失败", error);
      return false;
    }
  }
}

import type { Forwarded } from "../XEP0297/forward";
declare module "../../stanza" {
  interface Message {
    /** 由插件XEP0280添加 */
    readonly carbon?: {
      type: "received" | "sent";
      forwarded: Forwarded;
    };
  }
}

declare module "../../connection" {
  interface SocketEventMap {
    /** 由插件XEP0280添加 */
    "carbon:received": Message & { carbon: { type: "received"; forwarded: Forwarded } };
    /** 由插件XEP0280添加 */
    "carbon:sent": Message & { carbon: { type: "sent"; forwarded: Forwarded } };
  }
}

export default XEP0280;
