import { JID } from "@/JID";
import { MucSelfPing } from "./MucSelfPing";
import type { Plugin } from "../types";
import type Connection from "@/connection";
import { XMPPError, TimeoutError } from "@/errors";
import logger from "@/log";
import type { Message, Presence } from "@/stanza";

const log = logger.getLogger("XEP0410");

/**
 * self-ping 的解析结果。失败不是异常而是预期结果之一（超时即"状态未知"），
 * 因此与成功并列返回，调用方按 `ok` 分支处理。
 *
 * - `ok: true`：收到 IQ result 响应，服务端确认我们仍在房间内。
 * - `ok: false`：收到 IQ error 或请求超时；`error` 保留原始错误类型，
 *   `classify` 依赖 `TimeoutError` / `XMPPError` 区分后按 XEP-0410 §3.2 判定。
 */
export type PingResult =
  | { ok: true; duration: number }
  | { ok: false; error: Error };

/** ping 结果的归类：仍在房间 / 已离房（应重入）/ 状态未知（延后重试）。 */
type PingVerdict = "fresh" | "rejoin" | "retry";

/** XEP0410 插件配置项。 */
type Xep0410Config = {
  /** 单次 self-ping 等待响应的最长时间（毫秒）。超时只代表"状态未知"。 */
  pingTimeout: number;
  /** 房间连续多久没有 message/presence 才判定为失活（毫秒）。 */
  inactivityTimeout: number;
  /** 定时器扫描间隔（毫秒），检测延迟最多比失活阈值多一个间隔。 */
  checkInterval: number;
};

/**
 * XEP-0410: MUC Self-Ping (Schrödinger's Chat)
 *
 * 解决的问题：服务端/组件重启或链路中断后，客户端可能误以为自己仍在
 * MUC 房间中，从而静默丢失消息。本插件通过定期向自己的 occupant JID
 * （room@service/nick）发送 XEP-0199 ping 来探测房间状态：
 *
 * - ping 成功 → 仍在房间，重置活动基线；
 * - 服务端返回明确离房错误（如 not-acceptable）→ 自动重新加入；
 * - 超时或 S2S 临时错误 → 状态未知，延后重试，不贸然重入。
 *
 * 实现要点：
 * - **单一定时器**：按 config.checkInterval 扫描一次所有房间，配合每房间
 *   最后活动时间戳 Map，避免每房间一个 setTimeout 的 N 定时器开销；
 * - **只读 XEP0045**：房间成员与昵称只读 XEP0045.rooms（绝不修改其数据）；
 *   lastActivity 由本插件维护，且只由 ping 结果驱动：通了就替换为
 *   新基线，不通就重加入（规范：能 ping 通即仍在群内）。
 *
 * @see https://xmpp.org/extensions/xep-0410.html
 * @version 1.1.0 (2019-09-25)
 */
export class XEP0410 extends MucSelfPing implements Plugin {
  /** 依赖 XEP-0045（房间状态）与 XEP-0199（ping 能力），由 Connection 自动注册。 */
  static readonly dependencies = ["XEP0045", "XEP0199"] as const;
  private readonly config = {
    /** 单次 self-ping 等待响应的最长时间（毫秒）。超时只代表"状态未知"。 */
    pingTimeout: 10_000,
    /** 房间连续多久没有 message/presence 才判定为失活（毫秒）。 */
    inactivityTimeout: 15 * 60_000,
    /** 定时器扫描间隔（毫秒），检测延迟最多比失活阈值多一个间隔。 */
    checkInterval: 5 * 60_000,
  };
  readonly connection: Connection;

  /**
   * 房间 bare JID -> 最后活动时间戳（Date.now()）。
   * 由本插件独立维护：收到该房间的 message/presence 时刷新，
   * self-ping 成功时替换为新基线；不读写 XEP0045 的数据。
   */
  private readonly lastActivity = new Map<string, number>();
  /**
   * 房间 bare JID -> 首次进入 stale 状态前的最后活动时间。
   * 记录"沉默从何时开始"，供 muc:stale 事件和恢复判断使用；
   * 同一段 stale 期间只记录一次。
   */
  private readonly staleSince = new Map<string, number>();
  /**
   * 正在等待 ping 响应的房间 JID 集合。
   * ping 发出后立即加入，收到响应（或超时、会话结束）后才移除，
   * 防止同一房间同时发出多个并发 ping。
   */
  private readonly pendingPings = new Set<string>();
  /**
   * 正在执行重加入的房间 JID 集合。
   * join 请求在途期间加入、结束后移除，
   * 防止同一房间的失败恢复流程并发执行。
   */
  private readonly pendingRejoins = new Set<string>();
  /** 唯一的扫描定时器句柄，代替每房间一个 setTimeout。 */
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    connection: Connection,
    options?: Partial<Xep0410Config> | null,
  ) {
    super();
    this.connection = connection;
    this.config = {
      ...this.config,
      ...Object.fromEntries(
        Object.entries(options ?? {}).filter(([, value]) => value != null),
      ),
    };
  }

  /**
   * 插件初始化：挂接会话生命周期与房间活动监听。
   * 房间活动与 ping 结果只更新本插件的状态，不读写 XEP0045 的数据。
   */
  init() {
    // 会话建立：清空旧会话残留、为已加入房间重建活动基线、启动定时器。
    this.connection.on("session:start", () => {
      this.stop();

      // 为所有已加入房间设置活动基线，避免会话恢复时立即触发 ping。
      // todo 应该改为监听加入事件
      for (const roomJid of this.connection.XEP0045?.rooms.keys() ?? []) {
        this.lastActivity.set(roomJid, Date.now());
      }
      // 定时器已被上方 stop() 清除，直接重建。
      this.tickTimer = setInterval(
        () => this.onTick(),
        this.config.checkInterval,
      );
      this.tickTimer?.unref?.();
    });

    /**
     * 房间活动处理器：任何来自 MUC 的 message/presence 都算作房间活动，
     * 刷新本插件的活动基线。只处理本插件已跟踪的房间；
     * 加入/离开由 XEP0045 管理，这里不检测、不读写其数据。
     */
    const handleRoomActivity = (stanza: Message | Presence) => {
      // 错误类型的 stanza 不证明房间存活，不算活动。
      if (stanza.type === "error") return;
      const roomJid = stanza.from.bare;
      // 房间表是唯一的范围依据，非已加入房间的 bare JID 不进入活动表
      if (!this.connection.XEP0045!.rooms.has(roomJid)) {
        this.lastActivity.delete(roomJid);
        this.staleSince.delete(roomJid);
        return;
      };

      // 房间活动只刷新基线；muc:fresh 只由 ping 通 / 重入成功上报。
      this.lastActivity.set(roomJid, Date.now());
    };
    // presence不用剔除自己离开事件，上面会检查是否在 XEP0045.rooms 中
    this.connection.on("muc:groupchat", handleRoomActivity);
    this.connection.on("presence", handleRoomActivity);

    // 会话不可用（结束或断线）时停止一切检查。
    this.connection.on("session:end", () => this.stop());
    this.connection.on("disconnect", () => this.stop());

    // 自动重连期间的暂停/恢复由 Connection.isSessionActive 自动反映，无需在此监听
  }

  /**
   * 将房间标记为 stale（可能已丢失消息）并触发 muc:stale 事件。
   * 同一段 stale 期间只上报一次，避免每次扫描重复触发。
   *
   * @param roomJid 房间 bare JID
   * @param staleSince 沉默开始的时间戳（进入 stale 前的最后活动时间）
   */
  private markStale(roomJid: string, staleSince: number): void {
    // 已在 stale 状态则跳过，保证一次失活只上报一次。
    if (this.staleSince.has(roomJid)) return;

    this.staleSince.set(roomJid, staleSince);
    this.connection.emit("muc:stale", {
      roomJid,
      staleSince: new Date(staleSince),
    });
  }

  /**
   * 将房间标记为恢复（fresh）并触发 muc:fresh 事件。
   * 与 muc:stale 一一配对：触发后清除 stale 标记；若房间从未进入
   * stale 状态则无事可做。
   *
   * @param roomJid 房间 bare JID
   * @param recoveredAt 恢复时间戳
   * @param rejoined 是否经重新加入才恢复（ping 通为 false）
   */
  private markFresh(
    roomJid: string,
    recoveredAt: number,
    rejoined: boolean,
  ): void {
    const staleSince = this.staleSince.get(roomJid);
    if (staleSince === undefined) return;

    this.staleSince.delete(roomJid);
    this.connection.emit("muc:fresh", {
      roomJid,
      staleSince: new Date(staleSince),
      recoveredAt: new Date(recoveredAt),
      rejoined,
    });
  }

  /**
   * 停止定时器并清空全部状态。
   * 在 session:start（重建前）、session:end、disconnect 时调用。
   */
  private stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.lastActivity.clear();
    this.staleSince.clear();
    this.pendingPings.clear();
    this.pendingRejoins.clear();
  }

  /**
   * 定时器扫描：找出所有超过失活阈值（config.inactivityTimeout）未活动的房间，
   * 将其标记为 stale 并异步发送 self-ping（不阻塞扫描）。
   *
   * 每轮扫描的判定流程：
   * 1. 跳过已有 ping / 重入在途的房间，避免重复操作；
   * 2. 未超过失活阈值的房间直接跳过；
   * 3. 其余房间进入 stale → 发出 self-ping 并登记在途。
   * 房间列表与昵称只读 XEP0045.rooms（不修改其数据），
   * 活动基线（lastActivity）由本插件独立维护。
   */
  private onTick(): void {
    const muc = this.connection.XEP0045;
    if (!muc || !this.connection.isSessionActive) return;

    const now = Date.now();

    // 以 XEP0045.rooms 为准，清掉已离开房间的影子状态
    for (const roomJid of [
      ...this.lastActivity.keys(),
      ...this.staleSince.keys(),
    ]) {
      if (!muc.rooms.has(roomJid)) {
        this.lastActivity.delete(roomJid);
        this.staleSince.delete(roomJid);
      }
    }

    for (const [roomJid, info] of muc.rooms) {
      // 已有正在进行的 ping 或重入，跳过避免重复操作。
      if (this.pendingPings.has(roomJid) || this.pendingRejoins.has(roomJid))
        continue;

      const lastTime = this.lastActivity.get(roomJid);
      if (lastTime === undefined) {
        // 发现了没数据的房间，保险起见先跳过
        this.lastActivity.set(roomJid, now);
        log.warn(`房间 ${roomJid} 没有最后活动时间。`);
        continue;
      }

      // 未达到失活阈值，保持活跃状态。
      if (now - lastTime < this.config.inactivityTimeout) continue;
      // 下面都是超过失活阈值的房间，进入 stale 流程。
      // 进入 stale：记录沉默起点并发出 self-ping。
      this.markStale(roomJid, lastTime);
      this.pendingPings.add(roomJid);

      // ping 的成败由 PingResult 表达并交给 handlePingResult 分派；catch 只兜住
      // handlePingResult 自身的异常（本地缺陷），记录后不修改状态以免掩盖问题。
      this.pingOccupant(`${roomJid}/${info.nick}`)
        .then((status) => this.handlePingResult(roomJid, status))
        .catch((error: unknown) => {
          log.error(`Self-ping ${roomJid} 处理异常:`, error);
        })
        .finally(() => {
          this.pendingPings.delete(roomJid);
        });
    }
  }

  /**
   * 处理 self-ping 结果，按 XEP-0410 §3.2 的规则分派：
   *
   * - **成功**（或 service-unavailable / feature-not-implemented）：
   *   仍在房间，仅替换活动基线，不触发恢复事件；
   * - **明确离房错误**（如 not-acceptable、forbidden、gone）：
   *   直接重新加入；
   * - **超时或临时 S2S 错误**：状态未知，保留 stale 并延后重试，
   *   不立即重入。
   *
   * @param roomJid 房间 bare JID
   * @param status ping 的解析结果
   */
  private handlePingResult(roomJid: string, status: PingResult): void {
    // 已不在 stale 状态（另一条路径已恢复），无需再处理本次结果。
    if (!this.staleSince.has(roomJid)) return;

    switch (this.classify(status)) {
      case "fresh": {
        // 通了：仍在房间，替换为新活动基线并上报恢复（未经重加入）。
        const recoveredAt = Date.now();
        this.lastActivity.set(roomJid, recoveredAt);
        this.markFresh(roomJid, recoveredAt, false);
        break;
      }
      case "rejoin":
        // 明确离房错误：直接重新加入。
        void this.rejoinRoom(roomJid);
        break;
      case "retry":
        // 状态未知：保留 stale 状态并延后重试，不贸然重入。
        this.lastActivity.set(roomJid, Date.now());
        break;
    }
  }

  /**
   * 按 XEP-0410 §3.2 将 ping 结果归类：
   * - fresh：result，或 service-unavailable / feature-not-implemented
   *   （对端未实现 XEP-0199）、item-not-found（多会话昵称刚被更改）；
   * - rejoin：其余 XMPP 错误（not-acceptable、forbidden、gone 等）；
   * - retry：超时、remote-server-not-found / remote-server-timeout（S2S
   *   临时故障）及其他异常，不能证明离房。
   */
  private classify(status: PingResult): PingVerdict {
    if (status.ok) return "fresh";

    const error = status.error;
    if (error instanceof TimeoutError || !(error instanceof XMPPError)) {
      return "retry";
    }

    const condition = error.condition ?? "";
    if (
      [
        "service-unavailable",
        "feature-not-implemented",
        "item-not-found",
      ].includes(condition)
    ) {
      return "fresh";
    }
    if (
      ["remote-server-not-found", "remote-server-timeout"].includes(condition)
    ) {
      return "retry";
    }
    return "rejoin";
  }

  /**
   * 重新加入单个房间。
   *
   * 并发安全：通过 pendingRejoins 去重，同一房间同时只允许一个
   * join 请求在途；join 完成（成功或失败）后才允许下一次尝试。
   * 重入失败不会抛出异常，而是记录日志，等待下一轮扫描重试。
   *
   * @param roomJid 需要重加入的房间 bare JID（需存在于 XEP0045.rooms）
   */
  async rejoinRoom(roomJid: string): Promise<void> {
    const muc = this.connection.XEP0045;
    if (!muc || !this.connection.isSessionActive) return;

    // 已有重入在途，跳过，避免并发 join。
    if (this.pendingRejoins.has(roomJid)) return;

    // 房间信息以 XEP0045.rooms 为准，找不到说明已离开，跳过。
    const info = muc.rooms.get(roomJid);
    if (!info) return;

    // 进入重入流程：登记在途，join 结束后由 finally 释放标记。
    this.pendingRejoins.add(roomJid);
    let rejoined = false;
    try {
      // join 前再次确认会话仍有效，避免断线后的异步恢复请求。
      if (!this.connection.isSessionActive) return;
      await muc.join(roomJid, info.nick, { password: info.password });
      rejoined = true;
    } catch (e) {
      // 重入失败不抛出，记录日志后等待下一轮检查重试。
      log.warn(`重加入 ${roomJid} 失败:`, e);
    } finally {
      this.pendingRejoins.delete(roomJid);
      if (this.connection.isSessionActive && muc.rooms.has(roomJid)) {
        const recoveredAt = Date.now();
        if (rejoined) {
          // 成功：基线已被 join 期间的 self-presence 刷新，无需重复设置。
          this.markFresh(roomJid, recoveredAt, true);
        } else {
          // 失败：主动推进基线退避，避免立刻再次被判定失活。
          this.lastActivity.set(roomJid, recoveredAt);
        }
      }
    }
  }

  /**
   * 手动对所有已加入房间执行一次 self-ping（批量状态探测）。
   *
   * 与自动检测互不影响：此方法只发 ping 并返回结果，不改变
   * 内部的活动基线，也不触发重加入；适合手动触发或调试时使用。
   *
   * @returns 每个房间的 ping 结果，判定规则与自动流程一致
   */
  pingAllJoinedRooms(): Promise<{ roomJid: string; status: PingResult }[]> {
    const muc = this.connection.XEP0045;
    if (!muc) return Promise.resolve([]);

    return Promise.all(
      Array.from(muc.rooms, ([roomJid, info]) =>
        this.pingOccupant(`${roomJid}/${info.nick}`).then((status) => ({
          roomJid,
          status,
        })),
      ),
    );
  }

  /**
   * 发送 self-ping 到指定的 occupant JID（XEP-0199 ping）。
   *
   * 注意：这里捕获了所有错误并折叠进 PingResult，因此本方法
   * 永远不会 reject；调用方通过 `status.ok` 区分成功与失败。
   *
   * @param to occupant JID（如 'room@service/nick'）
   */
  async pingOccupant(to: string | JID): Promise<PingResult> {
    try {
      const duration = await this.connection.XEP0199!.ping(
        to.toString(),
        this.config.pingTimeout,
      );
      return { ok: true, duration };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }
}

declare module "@/connection" {
  interface SocketEventMap {
    /**
     * 房间被判定为失活（stale）：连续超过 config.inactivityTimeout
     * （默认 15 分钟）没有 message/presence，self-ping 已发出，
     * 期间消息可能丢失。应用可记录 staleSince，之后通过 MAM 补齐历史。
     * 检测延迟为 inactivityTimeout 再加最多一个 checkInterval（默认 5 分钟）。
     */
    "muc:stale": {
      roomJid: string;
      staleSince: Date;
    };
    /**
     * 房间恢复活动（fresh）：与 muc:stale 配对，表示 stale 状态结束。
     * self-ping 通（仍在房间）时 rejoined 为 false，经重新加入才恢复时为 true。
     * 即使恢复，stale 期间的历史仍可能需要通过 MAM 补齐。
     */
    "muc:fresh": {
      roomJid: string;
      staleSince: Date;
      recoveredAt: Date;
      rejoined: boolean;
    };
  }
}

export default XEP0410;
