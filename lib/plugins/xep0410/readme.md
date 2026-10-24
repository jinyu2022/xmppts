# XEP-0410 — MUC 自 Ping（薛定谔的聊天）

用 self-ping 检测自己是否仍在房间内，并对确认已离开的房间自动重加入。

- **依赖**：XEP-0045（房间状态）、XEP-0199（Ping）
- **实例访问**：`connection.XEP0410`

## 可配置项

每个实例独立配置，默认见下表；只能在注册时通过 `registerPlugin("XEP0410", options)` 覆盖。

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `pingTimeout` | `10_000` | 单次 self-ping 等待响应的最长时间（ms） |
| `inactivityTimeout` | `15 * 60_000` | 房间连续无 message/presence 多久判定失活（ms） |
| `checkInterval` | `5 * 60_000` | 定时扫描间隔（ms） |

## 注册后行为

`init()` 用单一扫描定时器统一维护所有已加入房间的空闲状态：

1. `session:start` 后只启动计时，不立即 ping（`XEP0045.rooms` 中已存在的房间直接建立基线）。
2. 已加入房间的 message/presence 重置该房间的计时；普通聊天与联系人 presence 不属于任何房间，不进入活动表。
3. 本人加入房间（§7.2.3 的 status 110）时建立基线，本人离开（110 且无 §7.6 的 303 改昵称标记）时回收该房间状态。
4. 连续 `inactivityTimeout` 无活动后，向自己的 `roomJid/nick` 发 self-ping（扫描粒度 `checkInterval`，超阈值后最多再等一个间隔才发出）。
5. 分析 ping 结果、排除假阳性；确认已离开则自动重加入。
6. 会话结束或断线时取消全部待执行检查。

房间列表、昵称、加入状态只读自 `XEP0045.rooms`；活动时间戳（`lastActivity`）由本插件独立维护，且只保存 `XEP0045.rooms` 中的房间。

## 扩展字段

无。

## 可监听事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `muc:stale` | `{ roomJid, staleSince }` | 房间失活，self-ping 已发出 |
| `muc:fresh` | `{ roomJid, staleSince, recoveredAt, rejoined }` | 房间已恢复（self-ping 通恢复为 `false`，经重入恢复为 `true`） |

## 公开 API

| 方法 | 说明 |
|------|------|
| `pingAllJoinedRooms()` | 手动 ping 所有已加入房间 → `Promise<{ roomJid, status: PingResult }[]>`（结果内含成功/失败，不 reject） |
| `rejoinRoom(roomJid)` | 手动重加入单个房间 → `Promise<void>`；房间不存在/会话失效静默返回，失败仅记日志不抛出 |
| `pingOccupant(occupantJid)` | Ping 单个房间成员（房间 occupant JID）→ `Promise<PingResult>`（`{ ok: true; duration } \| { ok: false; error }`），永不 reject |

### 假阳性排除（不触发重加入）

`service-unavailable`、`feature-not-implemented`、`item-not-found` 三者均视为仍在房间并触发 `muc:fresh`；`remote-server-not-found`、`remote-server-timeout` 视为超时——不重入、不发 `muc:fresh`，保留 stale 待下轮重试。

## 使用示例

全自动检测，以下为手动触发 / 调试用法：

```typescript
// 手动 ping 所有已加入房间 → Promise<{ roomJid, status: PingResult }[]>
const results = await client.XEP0410!.pingAllJoinedRooms();

// 手动重加入单个房间 → Promise<void>
await client.XEP0410!.rejoinRoom("room@conference.example.com");
```

### 监听房间失活 / 恢复

```typescript
client.on("muc:stale", ({ roomJid, staleSince }) => {
  console.log("房间失活", roomJid, staleSince);
});

client.on("muc:fresh", ({ roomJid, rejoined }) => {
  console.log("房间恢复", roomJid, rejoined);
});
```

## 注意事项

- 无需手动调用，`session:start` 时自动启动空闲计时。
- 空闲时间按房间分别统计，仅该房间（`XEP0045.rooms` 中的房间）的 message/presence 会重置计时。
- 只有确认已离开的房间才会重加入。
- 自动重连期间 `connection.isSessionActive` 为 `false`，检查自动暂停但不清理状态，重连成功后继续；`session:end` 才彻底停止。
- §4 两条 SHOULD 未实现：昵称变更应答前不暂停 self-ping（与 XEP-0045 无协作）、XEP-0198 休眠期不延后 ping（无依赖声明，见 debug M1）。
- §3.3 服务端优化 feature（`…/muc#self-ping-optimization`）未接入生产（见 debug M2）。