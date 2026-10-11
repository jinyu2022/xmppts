import { EventEmitter } from "events";
import { Form, type Field } from "../xep0004/form";
import { Iq } from "@/stanza"
import { XMPPElement } from "@/ltx/Element";
export class Register {
  static readonly NS = "jabber:iq:register" as const;

  static async createSocket(domain: string, protocol: "xmpps" | "ws") {
    if (protocol === "xmpps") {
      const { default: XEP0368 } = await import("../xep0368");
      const { connect } = await import("node:tls");
      const srv = await XEP0368.resolveDirectTLS(domain);
      const target = srv[0] ?? { host: domain, port: 5222 };
      return connect({
        host: target.host,
        port: target.port,
        // SRV target 常与账号域不同，SNI 需用账号域做证书校验
        servername: domain,
        timeout: 10_000,
      });
    } else {
      const { XMPPDiscoverer } = await import("../xep0156/discoverAltXMPP");
      const { websocket } = await XMPPDiscoverer.discoverAltXMPP(domain);
      if (!websocket) {
        throw new Error("未发现websocket地址");
      }
      const connection = new WSconnection(websocket);
      connection.connect();
      return connection;
    }
  }

  static createSubmitFormEL(username: string, password: string, captcha?: string, challenge?: string) {
    
    const fields: Field[] = [
      { type: "hidden" as const, var: "FORM_TYPE", values: [Register.NS] },
      { type: "text-single" as const, var: "username", values: [username] },
      { type: "text-private" as const, var: "password", values: [password] },
  ]
    // ocr/challenge 非 XEP-0077 v2.4 §13.4.1 登记字段，属服务器方言
    if (captcha) fields.push({ var: "ocr", values: [captcha] });
    if (challenge) fields.push({ var: "challenge", values: [challenge] });
    const form = Form.createFormEl({
      type: "submit",
      fields
    })
    const iq = Iq.createIq("set")
    const query = XMPPElement.createElementNS(Register.NS, "query")
    query.appendChild(form)
    iq.appendChild(query);
    iq.setAttribute("id", crypto.randomUUID());
    return iq;
  }
}

/**
 * 兼容TLSSocket api 的包装。
 * WebSocket 注册通道暂时禁用：旧 shims 已移除，保留此类供后续重构参考。
 */
export class WSconnection extends EventEmitter{
  readonly url: string;
  private socket: WebSocket| null = null;
  static readonly eventMap = {
    data: "message",
    close: "close",
    connect: "open",
    error: "error",
  } as const;
  constructor(url: string) {
    super();
    this.url = url;
  }

  connect() {
    throw new Error("WebSocket registration transport is temporarily disabled: shims has been removed.");
  }

  onOpen(data: unknown) {
    this.emit("connect", data);
  }

  onMessage(data: MessageEvent) {
    this.emit("data", data.data);
  }

  onClose(data: unknown) {
    this.emit("close", data);
  }

  onError(data: unknown) {
    this.emit("error", data);
  }
  
  write(data: string) {
    this.socket!.send(data);
  }

  close() {
    this.socket!.close();
  }
}

