import { Iq } from "@/stanza";
import { XMPPElement } from "@/ltx";
import { JID } from "@/JID";
export default class Ping {
    static readonly NS = "urn:xmpp:ping" as const;

    static createSendPingIq(to: string) {
        const iq = Iq.createIq("get", to);
        const ping = XMPPElement.createElementNS(Ping.NS, "ping");
        iq.appendChild(ping);
        return iq;
    }

    static createPingResultIq(from: string | JID, to: string | JID, id: string) {
        const iq = Iq.createIq("result", to);
        iq.setAttribute("from", from.toString());
        iq.setAttribute("id", id);
        return iq;
    }
}