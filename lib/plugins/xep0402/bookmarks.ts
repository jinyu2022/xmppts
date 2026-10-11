import { PEP } from "../xep0163/pep";
import { Pubsub, type PubsubNodeConfig } from "../xep0060/pubsub";
import type { JID } from "@/JID";
import { XMPPElement } from "@/ltx/Element";

/**
 * @see https://xmpp.org/extensions/xep-0402.html#table-1
 */
export interface Conference {
    /** 用户指定的群聊名称（备注）。客户端不应尝试从JID自动生成该信息。 */
    name?: string;
    /** 客户端登录时是否应该自动加入会议室。默认为false */
    autojoin?: boolean;
    /** 用户指定的群昵称，若无指定则使用XEP-0172指定的昵称 */
    nick?: string;
    /** 房间密码 */
    password?: string;
    /**
     * `<extensions/>` 的子元素（可能属于任意命名空间），已展开为数组。
     * 客户端在编辑项目时必须保留这些（尤其是保留未知元素），见 `createAddBookmarkIq`。
     */
    extensions?: XMPPElement[];
    /** 房间的jid */
    jid: string;
}

export class Bookmarks {
    static readonly NS = "urn:xmpp:bookmarks:1";

    /**
     * 书签节点应有的配置，取值见 XEP-0402 §3.3 Example 6：
     * 持久化、仅白名单可见、不向新订阅者推送最后一项
     */
    private static readonly NODE_CONFIG = {
        persistItems: true,
        maxItems: "max",
        sendLastPublishedItem: "never",
        accessModel: "whitelist",
    } as const satisfies PubsubNodeConfig;

    /**
     * 构造书签发布的 `<publish-options/>`（XEP-0060 §7.1.5）。
     * 服务端据此在发布前校验节点配置，避免把含房间密码的书签写进公开节点
     */
    static createPublishOptionsEl() {
        return Pubsub.createPublishOptionsEl(Bookmarks.NODE_CONFIG);
    }

    /**
     * 构造书签节点的 `#node_config` 表单（XEP-0060 §8.2），配置内容同发布前提条件。
     * 服务端不支持 publish-options 时，XEP-0402 §8 要求先配置节点再发布
     */
    static createNodeConfigForm() {
        return Pubsub.createNodeConfigForm(Bookmarks.NODE_CONFIG);
    }

    /**
     * 检索所有书签
     */
    static createRetrieveBookmarksIq(to: string | JID) {
        return PEP.createRetrieveItemsIq(to, Bookmarks.NS);
    }

    static parseBookmarksIq(iq: XMPPElement): Conference[] {
        const item = iq.getElementsByTagName("item");
        return Array.from(item).map((item) => {
            const conferenceEl = item.getElementsByTagName("conference")[0];
            return {
                ...Bookmarks.parseConferenceEl(conferenceEl).conference,
                // XEP-0402 书签的 JID 是 item 的 id 属性，conference不再包含jid属性
                jid: item.getAttribute("id")!,
            };
        });
    }

    static parseConferenceEl(
        conferenceEl: XMPPElement
    ): Record<"conference", Omit<Conference, "jid">> {
        if (
            conferenceEl.namespaceURI !== Bookmarks.NS ||
            conferenceEl.tagName !== "conference"
        )
            throw new Error("不是一个conference元素");
        // const jid = conferenceEl.getAttribute("jid") ?? void 0;
        const name = conferenceEl.getAttribute("name") ?? void 0;
        const autojoin = ["true", "1"].includes(
            conferenceEl.getAttribute("autojoin") ?? ""
        );
        const nick =
            conferenceEl.getElementsByTagName("nick")[0]?.textContent ?? void 0;
        const password =
            conferenceEl.getElementsByTagName("password")[0]?.textContent ?? void 0;
        // `<extensions/>` 与 conference 同属书签命名空间，展开为其子元素
        const extensionsEl = conferenceEl.getElementsByTagName("extensions")[0];
        const extensions = extensionsEl ? Array.from(extensionsEl.children) : void 0;
        return { conference: { name, autojoin, nick, password, extensions } };
    }
    /**
     * 添加书签就是发布新节点
     * @param conference 书签内容
     * @param publishOptions 可选，`<publish-options/>`（XEP-0060 §7.1.5）；传 `createPublishOptionsEl()` 可由服务端校验节点配置
     */
    static createAddBookmarkIq(
        conference: Conference,
        publishOptions?: XMPPElement,
    ) {
        const { jid, name, autojoin, nick, password, extensions } = conference;
        const publish = XMPPElement.createElement("publish", {
            node: Bookmarks.NS,
        });
        const item = XMPPElement.createElement("item", { id: jid });
        // conference 必须带书签命名空间（XEP-0402 §3.2），不能继承 pubsub 的默认命名空间
        const conferenceEl = XMPPElement.createElementNS(Bookmarks.NS, "conference");
        if (name) conferenceEl.setAttribute("name", name);
        if (autojoin) conferenceEl.setAttribute("autojoin", "true");
        if (nick) {
            const nickEl = XMPPElement.createElement("nick");
            nickEl.textContent = nick;
            conferenceEl.appendChild(nickEl);
        }
        if (password) {
            const passwordEl = XMPPElement.createElement("password");
            passwordEl.textContent = password;
            conferenceEl.appendChild(passwordEl);
        }
        if (extensions) {
            // extensions 是已展开的子元素数组，重新发布时需补回 `<extensions/>` 包装（XEP-0402 §3.2）
            const extensionsEl = XMPPElement.createElement("extensions");
            for (const child of extensions) extensionsEl.appendChild(child);
            conferenceEl.appendChild(extensionsEl);
        }
        item.appendChild(conferenceEl);
        publish.appendChild(item);
        return PEP.createPublishIq(publish, publishOptions);
    }

    /**
     * 删除书签意味着撤回由书签的 JID 标识的现有项目
     */
    static createDeleteBookmarkIq(jid: string) {
        const retract = PEP.createRetractIq(Bookmarks.NS, jid, true);
        return retract;
    }
}
