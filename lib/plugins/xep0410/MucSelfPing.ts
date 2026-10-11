import { XMPPElement } from "@/ltx/Element";
import Ping from "../xep0199/ping";
import { XMPPError } from "@/errors";
import { Iq } from "@/stanza";
/**
 * MUC Self-Ping (Schrödinger's Chat)
 * @link XEP-0410: https://xmpp.org/extensions/xep-0410.html
 */
export class MucSelfPing {
    static readonly NS = "http://jabber.org/protocol/muc#self-ping-optimization";

    /**
     * 构造自身 ping IQ，探测用户是否仍在 MUC 房间中
     * @param to occupant JID (e.g. 'room@service/nick')
     */
    static createSelfPingIq(to: string) {
        return Ping.createSendPingIq(to);
    }

    /**
     * 解析 self-ping IQ 响应
     * @param iqEl ping 响应的 IQ 元素
     */
    static parseSelfPingResponse(iqEl: XMPPElement) {
        if (iqEl.tagName !== "iq") throw new Error("expected iq element");
        const type = iqEl.getAttribute("type");
        if (type === "result") return Iq.parseIq(iqEl).iq;
        if (type === "error") {
            return new XMPPError(iqEl, "薛定谔");
        }
        throw new Error(`未知的 self-ping 响应类型: ${iqEl.toXMLString()}`);
    }

    /**
     * 检查 disco#info query 元素是否包含 self-ping 优化 feature
     * @param queryEl disco#info query 元素
     */
    static hasOptimizationFeature(queryEl: XMPPElement) {
        if (!queryEl) return false;
        const features = queryEl.getElementsByTagName("feature");
        return Array.from(features).some(
            (f) => f.getAttribute("var") === MucSelfPing.NS,
        );
    }
}

export default MucSelfPing;
