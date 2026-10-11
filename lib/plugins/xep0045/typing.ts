interface MUCUserPresBase {
    item?: MUCItem;
    statuses?: string[];
}

interface MUCUserPresMap {
    presence: MUCUserPresBase;
    destroy: MUCUserPresBase & { destroy: MUCDestroy };
    invite: MUCUserPresBase & { invites: MUCInvite[]; password?: string };
    decline: MUCUserPresBase & { decline: MUCDecline };
}

type MUCUserPresKind = keyof MUCUserPresMap;

export type MUCUserPres<
    T extends MUCUserPresKind = MUCUserPresKind
> = MUCUserPresMap[T];

interface MUCDestroy {
    jid?: string;
    password?: string;
    reason?: string;
}

interface MUCInvite {
    to?: string;
    from?: string;
    reason?: string;
    thread?: string;
    continue?: {
        thread?: string;
    };
}

interface MUCDecline {
    to?: string;
    from?: string;
    reason?: string;
}

type MUCAffiliation = "none" | "outcast" | "member" | "admin" | "owner";
type MUCRole = "none" | "visitor" | "participant" | "moderator";

export interface MUCItem {
    jid?: string;
    nick?: string;
    /** 部分 presence 只带 affiliation 或 role，二者都可缺省 */
    affiliation?: MUCAffiliation;
    role?: MUCRole;
    actor?: MUCActor;
    reason?: string;
}

interface MUCActor {
    nick?: string;
    jid?: string;
}

export interface MUCUser {
    /** 真实jid */
    jid?: string;
    nick: string;
    /** 随 presence 更新，可能尚未知（如仅带 role 的权限变更 presence） */
    affiliation?: MUCAffiliation;
    role?: MUCRole;
}