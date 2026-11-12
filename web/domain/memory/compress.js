/**
 * 每日压缩：当天结束后把事件层压成 1 条总结层，并删除当日原文。
 * 规则见 SPCD §8.6；总结长度上限见 §6.2。
 */
import * as dao from '../../infra/storage/dao.js';
import { createSummaryMemory } from './tier.js';
import { FIELD_LIMITS } from '../../../shared/contracts/index.js';

export const EMPTY_DAY_SUMMARY = '今天没发生什么特别的事。';

/** 把当天事件按时间顺序拼成一句 ≤80 字的总结 */
export function buildSummaryText(events = []) {
  const parts = events
    .map((event) => String(event?.content ?? '').trim().replace(/[。；;]+$/u, ''))
    .filter(Boolean);
  if (parts.length === 0) return EMPTY_DAY_SUMMARY;

  const text = parts.join('；');
  if (text.length <= FIELD_LIMITS.MEMORY_SUMMARY_MAX) return text;
  return `${text.slice(0, FIELD_LIMITS.MEMORY_SUMMARY_MAX - 1)}…`;
}

/**
 * 压缩一个居民当天的事件层。
 * 每天恰好 1 条总结：重复压缩时覆盖已有总结，不追加。
 */
export async function compressAgentDay({ agentId, day }) {
  const memories = await dao.listAllMemories(agentId);
  const todaysEvents = memories
    .filter((memory) => memory.tier === 'event' && memory.created_day === day)
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));

  const existing = memories.find(
    (memory) => memory.tier === 'summary' && memory.created_day === day
  );

  const summary = createSummaryMemory({
    agent_id: agentId,
    content: buildSummaryText(todaysEvents),
    created_day: day,
  });
  if (existing) summary.id = existing.id;
  await dao.putMemory(summary);
  for (const event of todaysEvents) {
    await dao.deleteMemory(event.id);
  }

  return summary;
}

/** 压缩 5 个居民当天的事件层，返回 5 条总结 */
export async function compressDay({ agents, day }) {
  if (!Array.isArray(agents)) {
    return [];
  }
  const summaries = [];
  for (const agent of agents) {
    summaries.push(await compressAgentDay({ agentId: agent.id, day }));
  }
  return summaries;
}
