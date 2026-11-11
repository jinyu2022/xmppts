import { XMPPElement } from "@/ltx";
import { Iq } from "@/stanza";
import logger from "@/log";
const log = logger.getLogger("XEP0280");
export class Carbons {
  static readonly NS = "urn:xmpp:carbons:2";

  static createEnableIq() {
    const iq = Iq.createIq("set");
    iq.appendChild(
      XMPPElement.createElementNS(Carbons.NS, "enable")
    );
    return iq;
  }

  static createDisableIq() {
    const iq = Iq.createIq("set");
    iq.appendChild(
      XMPPElement.createElementNS(Carbons.NS, "disable")
    );
    return iq;
  }


  static parseCarbonEl(carbon: XMPPElement) {
    if (carbon.namespaceURI !== Carbons.NS) {
      throw new Error(`不是一个 carbon 元素: ${carbon.toXMLString()}`);
    }
    // <private/> 与 received/sent 同属 carbons 命名空间：发送方用它声明不希望复制到其他资源，
    // 服务器不再负责剥离（XEP-0280 §9 互操作说明），接收方只记录标记，不能当作解析错误
    if (carbon.localName === "private") {
      return { carbonPrivate: true as const };
    }
    // 判断当前节点是否为 received/sent
    const received =
      carbon.tagName === "received"
        ? carbon
        : carbon.getElementsByTagName("received")[0];
    if (received) {
      return {
        carbon: {
          type: "received",
          forwarded: received.getElementsByTagName("forwarded")[0],
        },
      };
    }

    const sent =
      carbon.tagName === "sent"
        ? carbon
        : carbon.getElementsByTagName("sent")[0];
    if (sent) {
      return {
        carbon: {
          type: "sent",
          forwarded: sent.getElementsByTagName("forwarded")[0],
        },
      };
    }
    // 同命名空间内的未知元素按 RFC 6120 §11.4 忽略，不影响本条消息的其他内容
    log.warn(`未知的 carbon 元素: ${carbon.localName}`);
    return {};
  }
}
