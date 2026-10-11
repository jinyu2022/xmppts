import dns from 'node:dns/promises'; // 使用 promise 版本的 dns 模块
import type { SrvRecord } from 'node:dns'; // 导入 SrvRecord 类型
import logger from '@/log'; // 导入日志模块

const log = logger.getLogger('dns');
export interface EndpointInfo {
    host: string;
    port: number;
}

/**
 * 按 RFC 2782 生成 SRV 尝试顺序：
 * 先按 priority 升序分组；同一优先级内 weight=0 的记录排在前面，
 * 其余记录按 weight 加权随机依次选出（weight 越大被优先尝试的概率越高）。
 * 不修改原数组。
 */
function orderBySrvPriorityAndWeight(records: SrvRecord[]): SrvRecord[] {
    const ordered: SrvRecord[] = [];
    // 按 priority 分组（数字越小越优先）
    const byPriority = new Map<number, SrvRecord[]>();
    for (const record of records) {
        const group = byPriority.get(record.priority) ?? [];
        group.push(record);
        byPriority.set(record.priority, group);
    }
    const priorities = [...byPriority.keys()].sort((a, b) => a - b);
    for (const priority of priorities) {
        const group = byPriority.get(priority)!;
        while (group.length > 0) {
            const zeroIndex = group.findIndex(r => r.weight === 0);
            if (zeroIndex !== -1) {
                // weight=0 的记录不参与随机，优先尝试
                ordered.push(group.splice(zeroIndex, 1)[0]);
                continue;
            }
            // 加权随机：取 [0, 总权重) 均匀随机数，累计权重首个超过它的记录被选中
            const totalWeight = group.reduce((sum, r) => sum + r.weight, 0);
            let remaining = Math.random() * totalWeight;
            let pick = 0;
            for (let i = 0; i < group.length; i++) {
                remaining -= group[i].weight;
                if (remaining < 0) {
                    pick = i;
                    break;
                }
            }
            ordered.push(group.splice(pick, 1)[0]);
        }
    }
    return ordered;
}

/**
 * 查询 SRV 记录并生成 RFC 2782 尝试顺序
 * @param hostname 完整的 SRV 主机名，如 `_xmpp-client._tcp.example.com`
 * @returns 按优先级和加权随机排列的端点列表，查询失败或未找到时为空数组
 */
export async function resolveSrv(hostname: string): Promise<EndpointInfo[]> {
    log.debug(`Resolving SRV records: ${hostname}`);
    try {
        const resolver = new dns.Resolver({ timeout: 1000, tries: 2 });
        const records = await resolver.resolveSrv(hostname);
        // 生成尝试顺序，然后转换为 EndpointInfo 数组
        return orderBySrvPriorityAndWeight(records).map(record => ({
            host: record.name,
            port: record.port
        }));
    } catch (error) {
        log.warn(`SRV 查询失败: ${hostname}`, error);
        return [];
    }
}