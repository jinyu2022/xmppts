import { JID } from "@/JID";
import { Pubsub } from "../xep0060/pubsub";
import { XMPPElement } from "@/ltx/Element";
export class PEP {
    
    /**
     * 创建一个检索项目的 IQ 请求。
     * @param to - 要发送请求的 JID。
     * @param node - 要检索项目的节点标识符。
     * @param max - 可选，返回的最大项目数量。
     * @param itemIds - 可选，要检索的 ItemID 列表（§6.5.6 要求支持多个；IQ 的 id 由 `sendAsync` 分配）。
     * @returns 返回构建好的 IQ 消息元素，用于请求检索指定节点的项目。
     */
    static createRetrieveItemsIq(to: string|JID, node: string, max?: number, itemIds?: string[]){
        return Pubsub.createRetrieveItemsIq(to, node, max, itemIds);
    }
    /**
     * 创建一个发布消息的iq
     * @param publish - `<publish/>` 元素，含 node 属性与 item
     * @param publishOptions - 可选，`<publish-options/>` 发布选项
     * @returns 返回构建好的 IQ 消息元素
     */
    static createPublishIq(publish: XMPPElement, publishOptions?: XMPPElement){
        return Pubsub.createPublishIq(publish, publishOptions);
    }

    /**
     * 创建一个撤回消息的iq
     * @param node - 被撤回项目所在的节点 ID
     * @param id - 被撤回项目的 ItemID
     * @param notify - 可选，只有传 `true` 才要求服务通知订阅者
     * @returns 返回构建好的 IQ 消息元素
     */
    static createRetractIq(node: string, id: string, notify?: boolean){
        return Pubsub.createRetractIq(node, id, notify);
    }
}