/**
 * 记忆三层写入规则，对应 SPCD §6.2 / §8.6。
 *
 * - event：当天有效，当天结束压缩后丢弃原文
 * - summary：每天结束生成 1 条，永不删除
 * - impression：对某个人的一句主观印象，同一 target 覆盖更新（C4）
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { FIELD_LIMITS } from '../../../shared/contracts/index.js';

function assertContent(content, max, label) {
  if (typeof content !== 'string' || content.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, `${label}内容不能为空`);
  }
  if (content.length > max) {
    fail(ERROR_CODES.E_VALIDATION, `${label}不能超过 ${max} 个字符`);
  }
}

function assertDay(createdDay) {
  if (!Number.isInteger(createdDay) || createdDay < 0 || createdDay > 7) {
    fail(ERROR_CODES.E_VALIDATION, '记忆的 created_day 必须在 0–7 之间');
  }
}

function assertWeight(weight) {
  if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
    fail(ERROR_CODES.E_VALIDATION, '记忆的 weight 必须在 1–10 之间');
  }
}

/** 事件层：expire_day 必须等于 created_day */
export function createEventMemory({
  agent_id,
  content,
  created_day,
  target_agent_id = null,
  weight = 5,
}) {
  assertContent(content, FIELD_LIMITS.MEMORY_EVENT_MAX, '事件记忆');
  assertDay(created_day);
  assertWeight(weight);

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

/** 总结层：每天 1 条，≤80 字，永不过期 */
export function createSummaryMemory({ agent_id, content, created_day, weight = 7 }) {
  assertContent(content, FIELD_LIMITS.MEMORY_SUMMARY_MAX, '总结记忆');
  assertDay(created_day);
  assertWeight(weight);

  return {
    agent_id,
    tier: 'summary',
    content: content.trim(),
    target_agent_id: null,
    weight,
    created_day,
    expire_day: null,
  };
}

/** 印象层：必须指明对象，≤120 字，同一 target 由 DAO 覆盖更新（C4） */
export function createImpressionMemory({
  agent_id,
  target_agent_id,
  content,
  created_day,
  weight = 7,
}) {
  if (typeof target_agent_id !== 'string' || target_agent_id.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, '印象层必须指定 target_agent_id');
  }
  assertContent(content, FIELD_LIMITS.MEMORY_IMPRESSION_MAX, '印象记忆');
  assertDay(created_day);
  assertWeight(weight);

  return {
    agent_id,
    tier: 'impression',
    content: content.trim(),
    target_agent_id,
    weight,
    created_day,
    expire_day: null,
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
