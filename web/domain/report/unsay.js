/**
 * C6：每份小报固定 5 条 unsaid，与 5 个居民一一对应。
 * 缺失时重建，单个居民最多重建 2 次；仍缺失则用兜底句补齐并标记降级。
 */
export const UNSAY_MAX_REBUILDS = 2;

export function isValidUnsay(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 120;
}

/** 兜底句：保证结构与传播点不丢，但会标记 generation_mode=degraded */
export function fallbackUnsay(agent) {
  return `${agent.name}今天把一句话咽了回去，谁也没有听见。`;
}

/**
 * 补齐 5 条 unsaid。
 * @param {object} options
 * @param {Array} options.agents 5 个居民
 * @param {Array} [options.unsays] 已生成的 [{ agent_id, text }]
 * @param {(agent, attempt) => Promise<string>} [options.regenerate] 重建函数
 * @returns {Promise<{ unsays: Array, rebuilds: number, degraded: boolean }>}
 */
export async function ensureUnsays({ agents = [], unsays = [], regenerate } = {}) {
  const byAgent = new Map();
  for (const unsay of unsays) {
    if (!unsay || typeof unsay.agent_id !== 'string') continue;
    if (!isValidUnsay(unsay.text)) continue;
    if (byAgent.has(unsay.agent_id)) continue;
    byAgent.set(unsay.agent_id, { ...unsay, text: unsay.text.trim() });
  }

  let rebuilds = 0;
  let degraded = false;

  for (const agent of agents) {
    if (byAgent.has(agent.id)) continue;

    let rebuilt = null;
    if (typeof regenerate === 'function') {
      for (let attempt = 0; attempt < UNSAY_MAX_REBUILDS; attempt += 1) {
        rebuilds += 1;
        try {
          const text = await regenerate(agent, attempt);
          if (isValidUnsay(text)) {
            rebuilt = text.trim();
            break;
          }
        } catch {
          // 重建失败按缺失处理，继续下一次
        }
      }
    }

    if (rebuilt) {
      byAgent.set(agent.id, { agent_id: agent.id, agent_name: agent.name, text: rebuilt });
    } else {
      degraded = true;
      byAgent.set(agent.id, {
        agent_id: agent.id,
        agent_name: agent.name,
        text: fallbackUnsay(agent),
      });
    }
  }

  return {
    unsays: agents.map((agent) => byAgent.get(agent.id)),
    rebuilds,
    degraded,
  };
}
