import { XMPPElement } from "@/ltx/Element";
import { Presence, Message } from "@/stanza";
import { JID } from "@/JID";
import { PEP } from "../xep0163/pep";
export class Nickname {
    static readonly NS = "http://jabber.org/protocol/nick" as const;

    static parseNickEl(nick: XMPPElement) {
        if (nick.namespaceURI !== Nickname.NS) throw new Error("不是一个nick元素");
        return {
            nick: nick.textContent,
        };
    }

    static createNickSubscribe(to: string, nick: string) {
        const pres = Presence.createPresence(new JID(to).bare, "subscribe");
        const nickEl = XMPPElement.createElementNS(Nickname.NS, "nick");
        nickEl.textContent = nick;
        pres.appendChild(nickEl);
        return pres;
    }

    static createNickMessage(to: string,message:string, nick: string) {
        const msg = Message.createMessage(to, message, "chat");
        const nickEl = XMPPElement.createElementNS(Nickname.NS, "nick");
        nickEl.textContent = nick;
        msg.appendChild(nickEl);
        return msg;
    }

    /**
     * 创建发布昵称的iq
     *
     * 结构按 XEP-0060 §7.1.1：`<pubsub><publish node><item><nick/></item></publish></pubsub>`
     * @param nick 昵称
     */
    static createNickPublishIq(nick: string) {
        const publish = XMPPElement.createElement("publish", {
            node: Nickname.NS,
        });
        const item = XMPPElement.createElement("item");
        const nickEl = XMPPElement.createElementNS(Nickname.NS, "nick");
        nickEl.textContent = nick;
        item.appendChild(nickEl);
        publish.appendChild(item);
        return PEP.createPublishIq(publish);
    }

    /**
     * 创建获取昵称的iq
     * 
     */
    static createRetrieveNickIq(jid: string) {
        return PEP.createRetrieveItemsIq(jid, Nickname.NS, 1);
    }
    //不打算支持回退到0060

}
