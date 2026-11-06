import type Connection from "@/connection";
import type { JID } from "@/JID";
import type { Plugin } from "../types";
import { OccupantId, type OccupantID } from "./occupantId";

/**
 * XEP-0421: Anonymous unique occupant identifiers for MUCs
 *
 * 解析房间附加在消息与出席上的 `<occupant-id/>`。规范要求仅在房间
 * 通过 disco#info 宣告 `urn:xmpp:occupant-id:0` 时才信任该字段，
 * 使用 {@link XEP0421.hasOccupantIdFeature} 校验。
 * @see https://xmpp.org/extensions/xep-0421.html
 * @version 1.0.1 (2025-04-09)
 */
export class XEP0421 extends OccupantId implements Plugin {
    static readonly dependencies = ["XEP0030"] as const;
    private readonly connection: Connection;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    init() {
        // occupant-id 是房间能力，由 MUC 在 disco#info 中宣告；客户端不代其宣告
        this.connection.registerStanzaPlugin(
            OccupantId.NS,
            OccupantId.parseOccupantIdEl,
        );
    }

    /**
     * 检查房间是否宣告 occupant-id 特性
     *
     * 房间未宣告时，`message.occupantID` / `presence.occupantID` 可能来自
     * 其他住户的伪造，不应信任（XEP-0421 §5）。
     * @param room 房间 bare JID
     */
    async hasOccupantIdFeature(room: string | JID): Promise<boolean> {
        const info = await this.connection.XEP0030!.getDiscoInfo(room);
        return info.features.has(OccupantId.NS);
    }
}

declare module "../../stanza" {
    interface Message {
        /** XEP0421: 房间为该消息发送者分配的稳定标识 */
        occupantID?: OccupantID;
    }
    interface Presence {
        /** XEP0421: 房间为该住户分配的稳定标识 */
        occupantID?: OccupantID;
    }
}

export default XEP0421;
