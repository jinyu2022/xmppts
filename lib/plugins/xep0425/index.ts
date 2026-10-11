import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { Message } from "@/stanza";
import type { Plugin } from "../types";
import { Moderation } from "./moderation";
import { Iq } from "@/stanza";
import { XMPPError } from "@/errors";

/**
 * XEP-0425: Moderated Message Retraction
 * 
 * 实现消息审核和撤回功能，允许 MUC 审核员撤回其他用户发送的消息。
 * 支持服务发现、审核请求发送和审核消息处理。
 * 
 * @see https://xmpp.org/extensions/xep-0425.html
 * @version 0.3.0 (2023-03-02)
 */
export class XEP0425 extends Moderation implements Plugin {
    static readonly dependencies = ["XEP0030", "XEP0424"] as const;
    readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        // 向服务发现中注册审核功能
        // 群聊才需要，客户端不要
        // this.connection.XEP0030!.addFeature(Moderation.NS);

        // 注册 stanza 插件
        // 审核标记 <moderated/> 的载体是 XEP0424 的 <retract/> / <retracted/>，
        // 由 XEP0424 的转换器原样转交后才会到达这里
        this.connection.registerStanzaPlugin(Moderation.NS, Moderation.parseModeration);

        // 注册消息审核事件
        this.connection.registerEventPlugin("message:moderated", {
            tagName: "message",
            matcher: (message) => message.moderated != null,
        });
    }

    /**
     * 发送消息审核请求
     * 
     * 向 MUC 发送一个审核请求，请求撤回指定的消息。
     * 该请求应发送给 MUC 服务（not to a user）。
     * 
     * @param to - MUC 的 JID
     * @param id - 要撤回的消息的 stanza ID（通常由 MUC 添加，需使用由 MUC 添加的 ID）
     * @param reason - 审核原因的可选描述
     * @returns 返回创建的 IQ 节点
     */
    moderate(to: string | JID, id: string, reason?: string) {
        const iq = Iq.createIq("set", to);
        iq.appendChild(Moderation.createModerationEl(id, reason));
        this.connection.send(iq);
        return iq;
    }

    /**
     * 发送异步审核请求并等待结果
     * 
     * 向 MUC 发送审核请求，并异步等待响应。
     * 成功时返回空响应，失败时抛出错误。
     * 
     * @param to - MUC 的 JID
     * @param id - 要撤回的消息的 stanza ID
     * @param reason - 审核原因的可选描述
     * @returns 返回审核结果的 Promise
     * @throws {Error} 当审核请求被拒绝时抛出错误
     */
    async moderateAsync(to: string | JID, id: string, reason?: string) {
        const iq = Iq.createIq("set", to);
        iq.appendChild(Moderation.createModerationEl(id, reason));
        const res = await this.connection.sendAsync(iq);
        if (res.getAttribute("type") === "error") {
            throw new XMPPError(res, "审核消息失败");
        }
        return res;
    }
}

declare module "@/stanza" {
    interface Message {
        /** XEP0425: 消息已被审核标记 */
        moderated?: { by?: string; reason?: string };
    }
}

declare module "@/connection" {
    interface SocketEventMap {
        /** XEP0425: 消息已被审核 */
        "message:moderated": Message & { moderated: { by?: string; reason?: string } };
    }
}

export default XEP0425;