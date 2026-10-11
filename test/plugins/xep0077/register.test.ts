import { describe, it, expect } from "vitest";
import { Register } from "../../../lib/plugins/xep0077/register";

/**
 * XEP-0077: In-Band Registration
 * @see https://xmpp.org/extensions/xep-0077.xml
 * @version 2.4 (2012-01-25)
 *
 * 构造用例取自 §4 Extensibility（x:data 表单承载注册字段）、
 * §14.1（jabber:iq:register schema）与 §13.4.1（FORM_TYPE 注册字段名）。
 */
describe("Register", () => {
  describe("createSubmitFormEL", () => {
    it("§4：生成 set IQ，query 内嵌 x:data 提交表单", () => {
      const iq = Register.createSubmitFormEL("juliet", "R0m30");
      expect(iq.getAttribute("type")).toBe("set");
      expect(typeof iq.getAttribute("id")).toBe("string");
      const query = iq.getElementsByTagNameNS(Register.NS, "query")[0];
      const formEl = query.getElementsByTagName("x")[0];
      expect(formEl.namespaceURI).toBe("jabber:x:data");
      expect(formEl.getAttribute("type")).toBe("submit");
    });

    it("§13.4.1：FORM_TYPE 为 jabber:iq:register，并含 username/password 字段", () => {
      const iq = Register.createSubmitFormEL("juliet", "R0m30");
      const xmlStr = iq.toXMLString();
      expect(xmlStr).toContain("FORM_TYPE");
      expect(xmlStr).toContain(Register.NS);
      expect(xmlStr).toContain("username");
      expect(xmlStr).toContain("juliet");
      expect(xmlStr).toContain("password");
      expect(xmlStr).toContain("R0m30");
    });

    it("§3.1：提供 captcha/challenge（方言字段）时额外输出 ocr 与 challenge", () => {
      const iq = Register.createSubmitFormEL(
        "juliet",
        "R0m30",
        "captcha_value",
        "challenge_token",
      );
      const xmlStr = iq.toXMLString();
      expect(xmlStr).toContain("ocr");
      expect(xmlStr).toContain("captcha_value");
      expect(xmlStr).toContain("challenge");
      expect(xmlStr).toContain("challenge_token");
    });
  });
});
