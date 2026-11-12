/**
 * 印象层更新：同一 target 只保留 1 条（C4）。
 * 覆盖逻辑在 DAO 的 putMemory 中完成，这里只负责按 §6.2 校验字段。
 */
import * as dao from '../../infra/storage/dao.js';
import { createImpressionMemory } from './tier.js';

export async function upsertImpression({
  agent_id,
  target_agent_id,
  content,
  day,
  weight = 7,
}) {
  const memory = createImpressionMemory({
    agent_id,
    target_agent_id,
    content,
    created_day: day,
    weight,
  });
  return dao.putMemory(memory);
}

export async function listImpressions(agentId) {
  return dao.listMemories(agentId, 'impression');
}

export async function getImpression(agentId, targetAgentId) {
  const rows = await listImpressions(agentId);
  return rows.find((memory) => memory.target_agent_id === targetAgentId) ?? null;
}
