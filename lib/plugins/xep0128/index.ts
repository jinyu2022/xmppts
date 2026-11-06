import { Form } from "../xep0004/form";
import type { XMPPElement } from "@/ltx";
/**
 * XEP-0128: Service Discovery Extensions  
 * 已经包含在XEP-0030中，无需额外导入
 * @see https://xmpp.org/extensions/xep-0128.html
 * @version 1.0.1 (2019-07-30)
 */
export class XEP0128 {
    static parseDataForm(xml: XMPPElement) {
        if (xml.namespaceURI !== Form.NS) {
            if (xml.localName === "x") {
                throw new Error(`不是一个 x 元素: ${xml.toXMLString()}`);
            }
            xml = xml.getElementsByTagNameNS(Form.NS, "x")[0];
            if (!xml) {
                return { form: void 0 };
            }
        }
        return Form.parseFormEl(xml);
    }
}