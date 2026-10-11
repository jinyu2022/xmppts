import { Form, type DataForm } from "../xep0004/form";

import { XMPPError, TimeoutError } from "@/errors";
import { Register } from "./register";
import type { TLSSocket } from "node:tls";
import { EventEmitter } from "events";
import { Parser } from "@/ltx/Parser";
import type { XMPPElement } from "@/ltx/Element";
import logger from "@/log";
const log = logger.getLogger("XEP0077");
/**
 * XEP-0077: In-Band Registration
 * @see https://xmpp.org/extensions/xep-0077.html
 * @version 2.4 (2012-01-25)
 */
export default class XEP0077 extends Register {
  private domain?: string;
  private socket: TLSSocket | null = null;
  private readonly event = new EventEmitter();
  private protocol?: "xmpps" | "ws";
  private registrationForm?: DataForm;
  /** 表单查询已有结果（成功或失败），供 getRegistrationForm 判断是否还要等待 */
  private registrationResolved = false;
  /** 是否已发出表单查询，避免多轮 stream:features 重复查询 */
  private formQuerying = false;
  /** 常驻 XML 解析器：socket 的 data 事件边界与 stanza 边界不一致 */
  private readonly parser = new Parser();
  /** 等待响应的请求，键为 iq 的 id */
  private readonly pending = new Map<string, {
    resolve: (res: XMPPElement) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  constructor() {
    super();
    this.parser.on("tree", (tree) => this.onTree(tree));
    this.parser.on("error", (error) => log.error("解析失败:", error));
  }
  init() {
    // 走独立 socket，不需要在 Connection 生命周期里注册任何东西
  }
  // 设置监听器
  setListener() {
    const socket = this.socket!;

    // direct TLS 需等握手完成（secureConnect）再发流头
    socket.once(this.protocol === "xmpps" ? "secureConnect" : "connect", () => {
      if (this.protocol === "xmpps") {
        socket.write(
          `<?xml version="1.0"?><stream:stream to="${this.domain}" version="1.0" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams">`
        );
      } else {
        socket.write(
          `<open to="${this.domain}" version="1.0" xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>`
        );
      }
    });

    socket.once("close", () => {
      // 清除全部监听器
      socket.removeAllListeners();
      this.event.removeAllListeners();
      this.socket = null;
      // 未完成的请求不会再有响应，逐个失败
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`连接已关闭，请求 ${id} 未完成`));
      }
      this.pending.clear();
    });
    socket.on("data", (data) => this.parser.write(data.toString()));
  }

  async connectSocket(domain: string, protocol: "xmpps" | "ws") {
    this.domain = domain;
    this.protocol = protocol;
    // WSconnection 自称兼容 TLSSocket，此处按 TLSSocket 处理（WS 分支当前不可用）
    this.socket = ((await Register.createSocket(domain, protocol)) as TLSSocket) ?? null;
    this.setListener();
  }

  /** 把收到的原始数据写进常驻解析器 */
  parse(data: string) {
    this.parser.write(data);
  }

  /** 常驻解析器产出的完整元素 */
  private onTree(tree: XMPPElement) {
    if (tree.localName === "features") {
      this.onFeatures(tree);
      return;
    }
    const id = tree.getAttribute("id");
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(tree);
  }

  /** 处理 stream:features：发现注册能力后查询注册表单（XEP-0077 §3.1、§8） */
  private onFeatures(features: XMPPElement) {
    if (this.formQuerying || this.registrationResolved) return;
    const registerEl = features.getElementsByTagNameNS(
      "http://jabber.org/features/iq-register",
      "register"
    )[0];
    if (!registerEl) {
      log.debug("服务器不支持带内注册");
      this.finishRegistration(null);
      return;
    }
    this.formQuerying = true;
    this.sendAsync(`<iq type='get'><query xmlns='${XEP0077.NS}'/></iq>`)
      .then((res) => {
        const formEl = res.getElementsByTagNameNS(Form.NS, "x")[0];
        if (!formEl) {
          // 服务器也可以回固定的 username/password 字段而不下发 data form
          log.debug("注册响应不含 data form");
          this.finishRegistration(null);
          return;
        }
        const { form } = Form.parseFormEl(formEl);
        this.registrationForm = form;
        this.finishRegistration(form);
      })
      .catch((error) => {
        log.error("查询注册表单失败:", error);
        this.finishRegistration(null);
      });
  }

  /** 表单查询收尾：成功传表单、失败传 null，通知所有等待者 */
  private finishRegistration(form: DataForm | null) {
    this.formQuerying = false;
    this.registrationResolved = true;
    this.event.emit("registration", form);
  }

  sendAsync(data: string | XMPPElement, timeout = 10_000): Promise<XMPPElement> {
    if (!this.socket) return Promise.reject(new Error("未连接"));

    const xml = typeof data === "string" ? Parser.parse(data) : data;
    // 未指定 id 时自动生成，避免调用方必须自己保证唯一
    const id = xml.getAttribute("id") ?? crypto.randomUUID();
    xml.setAttribute("id", id);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`请求超时: ${id}`));
      }, timeout);
      timer.unref?.();

      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(xml.toXMLString());
    });
  }

  getRegistrationForm() {
    if (this.registrationForm) {
      return Promise.resolve(this.registrationForm);
    }
    if (this.registrationResolved) {
      // 已有结论（例如服务器不支持注册），不必再等事件
      return Promise.resolve<DataForm | null>(null);
    }
    return new Promise<DataForm | null>((resolve, reject) => {
      const socket = this.socket;
      const onRegistration = (form: DataForm | null) => {
        socket?.off("close", onClose);
        resolve(form);
      };
      const onClose = () => {
        this.event.off("registration", onRegistration);
        reject(new Error("连接已关闭"));
      };
      this.event.once("registration", onRegistration);
      socket?.once("close", onClose);
    });
  }

  /**
   * 注册账号 - Element重载
   * @param iq IQ请求Element
   */
  register(iq: XMPPElement): Promise<boolean>;

  /**
   * 注册账号 - 参数重载
   * @param username 用户名
   * @param password 密码
   * @param captcha 可选验证码
   * @param challenge 可选challenge
   */
  register(
    username: string,
    password: string,
    captcha?: string,
    challenge?: string
  ): Promise<boolean>;

  async register(
    iqOrUsername: XMPPElement | string,
    password?: string,
    captcha?: string,
    challenge?: string
  ): Promise<boolean> {
    let iq: XMPPElement;

    if (typeof iqOrUsername === "string") {
      if (!password) throw new Error("密码不能为空");
      const challengeValue = this.registrationForm?.fields.find(
        (field) => field.var === "challenge"
      )?.values[0];
      iq = XEP0077.createSubmitFormEL(
        iqOrUsername,
        password,
        captcha,
        challengeValue ?? challenge
      );
    } else {
      iq = iqOrUsername;
    }

    log.debug("注册提交:", () => iq.toXMLString());
    const res = await this.sendAsync(iq);
    if (res.getAttribute("type") === "result") {
      return true;
    } else {
      throw new XMPPError(res, "注册失败");
    }
  }
}
