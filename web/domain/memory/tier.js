/**
 * 记忆三层写入规则（M2 只实现事件层，summary / impression 由 M3 补齐）。
 * 字段与长度约束见 SPCD §6.2 / §8.6。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { FIELD_LIMITS } from '../../../shared/contracts/index.js';

/** 事件层：当天有效，写满即压，expire_day 必须等于 created_day */
export function createEventMemory({
  agent_id,
  content,
  created_day,
  target_agent_id = null,
  weight = 5,
}) {
  if (typeof content !== 'string' || content.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, '事件记忆内容不能为空');
  }
  if (content.length > FIELD_LIMITS.MEMORY_EVENT_MAX) {
    fail(ERROR_CODES.E_VALIDATION, `事件记忆不能超过 ${FIELD_LIMITS.MEMORY_EVENT_MAX} 个字符`);
  }
  if (!Number.isInteger(created_day) || created_day < 0 || created_day > 7) {
    fail(ERROR_CODES.E_VALIDATION, '事件记忆的 created_day 必须在 0–7 之间');
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
    fail(ERROR_CODES.E_VALIDATION, '事件记忆的 weight 必须在 1–10 之间');
  }

  return {
    agent_id,
    tier: 'event',
    content: content.trim(),
    target_agent_id,
    weight,
    created_day,
    expire_day: created_day,
  };
}

/**
 * 一段对话为双方各写 1 条事件记忆。
 */
export function createDialogueMemories({ dialogue, agents }) {
  const [firstId, secondId] = dialogue?.participant_ids ?? [];
  const first = agents.find((agent) => agent.id === firstId);
  const second = agents.find((agent) => agent.id === secondId);
  if (!first || !second || first.id === second.id) {
    fail(ERROR_CODES.E_VALIDATION, '对话参与者必须是一对有效居民');
  }

  const rounds = dialogue.rounds ?? dialogue.transcript?.length ?? 0;
  const gist = (dialogue.transcript ?? [])
    .map((round) => round.content)
    .join(' ')
    .slice(0, 60);

  const make = (self, other) =>
    createEventMemory({
      agent_id: self.id,
      target_agent_id: other.id,
      content: `在${dialogue.location}和${other.name}聊了${rounds}轮：${gist}`,
      created_day: dialogue.day,
      weight: 6,
    });

  return [make(first, second), make(second, first)];
}
