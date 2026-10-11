import type { JID } from "@/JID";
import { XMPPElement } from "@/ltx/Element";
import { Message, type MsgType } from "@/stanza";
import { XMPPDateTime } from "../xep0082/dateTime";

/**
 * XMPP 消息类型定义（复用 `@/stanza` 的 MsgType，避免重复维护）
 * - "normal": 普通消息
 * - "chat": 一对一聊天消息
 * - "groupchat": 群组聊天消息
 * - "error": 错误消息
 */
export type MessageType = MsgType;

/**
 * XEP-0424: 消息撤回
 * 
 * 实现 XMPP 消息撤回扩展协议，用于允许用户撤回已发送的消息。
 * @link https://xmpp.org/extensions/xep-0424.html
 */
export class Retraction {
    static readonly NS = "urn:xmpp:message-retract:1" as const;
    static readonly NS_TOMBSTONE = "urn:xmpp:message-retract:1#tombstone" as const;

    /**
     * 解析消息撤回元素
     * 
     * 从 XML 元素中解析撤回请求或撤回标记信息。
     * 支持两种元素类型：
     * - "retract": 撤回请求元素
     * - "retracted": 撤回标记元素
     * 
     * @param retractEl - 要解析的撤回 XML 元素
     * @throws {Error} 当元素命名空间不合法或缺少必要属性时抛出错误
     */
    static parseRetractionEl(retractEl: XMPPElement) {
        if (retractEl.namespaceURI !== Retraction.NS) {
            throw new Error(`非法命名空间的消息撤回元素: ${retractEl.toXMLString()}`);
        }

        const id = retractEl.getAttribute("id");
        if (!id) {
            throw new Error(`消息撤回元素缺少 id: ${retractEl.toXMLString()}`);
        }

        /** `<reason/>` 文本；该子元素不在 XEP0424 的 schema/正文里，是 XEP0425 §3.1/§4 通知的实际做法 */
        let reason: string | undefined;
        /** 其它命名空间的直接子元素（如 XEP0425 的 `<moderated/>`）：本插件不认识，原样保留并转交 */
        const extensions: Record<string, XMPPElement> = {};
        for (const child of retractEl.children) {
            if (child.localName === "reason") {
                reason ??= child.textContent;
            } else if (child.namespaceURI && child.namespaceURI !== Retraction.NS) {
                extensions[child.localName] = child;
            }
        }

        // 处理 retract 元素：撤回请求
        if (retractEl.tagName === "retract") {
            return {
                retract: { id, reason },
                ...extensions,
            };
        }

        // 处理 retracted 元素：撤回标记
        if (retractEl.tagName === "retracted") {
            const stamp = retractEl.getAttribute("stamp");
            let stampDate: Date | undefined;
            if (stamp) {
                // parseDateTime 对非法格式抛错，转成带元素上下文的 Error
                try {
                    stampDate = XMPPDateTime.parseDateTime(stamp);
                } catch (error) {
                    throw new Error(
                        `retracted 的 stamp 不是合法的 dateTime：${(error as Error).message}: ${retractEl.toXMLString()}`,
                        { cause: error }
                    );
                }
            }
            return {
                retracted: {
                    id,
                    stamp: stampDate,
                    // §9 schema 中的可选属性，正文未说明语义，按原值保留
                    by: retractEl.getAttribute("by") ?? void 0,
                    reason,
                },
                ...extensions,
            };
        }

        throw new Error(`未知的消息撤回元素标签: ${retractEl.toXMLString()}`);
    }

    /**
     * 创建消息撤回请求元素
     * 
     * 根据指定的消息 ID 创建一个撤回请求元素，该元素应被附加到消息节中。
     * 
     * @param id - 要撤回的消息的唯一标识符
     * @returns 返回创建的撤回请求 XML 元素
     */
    static createRetractionEl(id: string) {
        const retract = XMPPElement.createElementNS(Retraction.NS, "retract", {
            id,
        });
        return retract;
    }

    /**
     * 创建包含撤回请求的消息节
     * 
     * 创建一个完整的消息节，包含对指定消息的撤回请求。
     * 该方法是 {@link createRetractionEl} 的高级封装，直接返回可发送的消息节。
     * 
     * @param to - 消息接收者的 JID（裸 JID 或完整 JID）
     * @param id - 要撤回的消息的唯一标识符
     * @param type - 消息类型，默认为 "chat"
     * @param fallbackText - 回退文本，用于不支持撤回的客户端显示
     * @returns 返回包含撤回请求的消息节
     */
    static createRetractionMessage(
        to: string | JID,
        id: string,
        type: MessageType = "chat",
        fallbackText?: string,
    ) {
        const message = Message.createMessage(to, fallbackText, type);
        message.appendChild(Retraction.createRetractionEl(id));
        // TODO: 追加 XEP-0428 <fallback/>（有回退文本时）与 XEP-0334 <store/> 提示，
        // 待对应的 XEP-0428 / XEP-0334 插件建立后由它们提供。
        return message;
    }
}

/**
 * {@link Retraction} 的默认导出
 */
export default Retraction;
