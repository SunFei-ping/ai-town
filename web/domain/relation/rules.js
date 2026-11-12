/**
 * 关系值规则，对应 SPCD §8.5。
 *
 * 事件 → affinity 变化（初始值）：
 *   正向对话（≥3 轮）+3；明显分歧 -4；用户事件 ±2 ~ ±5；无互动向 0 衰减 1。
 * 单日单对关系变化幅度上限 ±8。
 * 标签映射见 ./label.js。
 */
import { labelForAffinity } from './label.js';

export const DAILY_DELTA_CAP = 8;
export const DIALOGUE_POSITIVE_DELTA = 3;
export const DIALOGUE_CONFLICT_DELTA = -4;
export const USER_EVENT_MIN_DELTA = 2;
export const USER_EVENT_MAX_DELTA = 5;
export const DECAY_DELTA = 1;
/** task.md M2-05 验收口径：三天无互动衰减 1 点 */
export const DECAY_IDLE_DAYS = 3;

export function clampDelta(delta) {
  return Math.max(-DAILY_DELTA_CAP, Math.min(DAILY_DELTA_CAP, delta));
}

export function clampAffinity(value) {
  return Math.max(-100, Math.min(100, value));
}

/** 一段对话带来的关系变化：≥3 轮记正向，有明显分歧记负向 */
export function dialogueDelta(dialogue) {
  const rounds = dialogue?.transcript?.length ?? 0;
  let delta = 0;
  if (rounds >= 3) delta += DIALOGUE_POSITIVE_DELTA;
  if (dialogue?.disagreement) delta += DIALOGUE_CONFLICT_DELTA;
  return clampDelta(delta);
}

/** 用户事件直接关联某两人：按强度 0–1 映射到 ±2 ~ ±5 */
export function userEventDelta(intensity, sign = 1) {
  const ratio = Math.max(0, Math.min(1, Number(intensity) || 0));
  const magnitude = Math.round(USER_EVENT_MIN_DELTA + (USER_EVENT_MAX_DELTA - USER_EVENT_MIN_DELTA) * ratio);
  return sign < 0 ? -magnitude : magnitude;
}

/** 向 0 衰减 1 点 */
export function decayDelta(affinity) {
  if (affinity > 0) return -DECAY_DELTA;
  if (affinity < 0) return DECAY_DELTA;
  return 0;
}

export function shouldDecay(previous, day, idleDays = DECAY_IDLE_DAYS) {
  if (!previous || !Number.isInteger(previous.updated_day)) return false;
  return day - previous.updated_day >= idleDays;
}

/**
 * 在上一版关系上应用当日变化，并推导标签。
 * friend_streak 按天累计，用于「affinity ≥ 50 且持续 2 天」。
 */
export function nextRelation({ previous, delta, day }) {
  const base = previous?.affinity ?? 0;
  const affinity = clampAffinity(base + clampDelta(delta));
  const previousStreak = previous?.friend_streak ?? 0;
  const friend_streak =
    affinity >= 50
      ? previous?.updated_day === day
        ? previousStreak
        : previousStreak + 1
      : 0;

  return {
    ...previous,
    affinity,
    friend_streak,
    label: labelForAffinity(affinity, friend_streak),
    updated_day: day,
  };
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 计算当天需要写回的关系记录。
 * - 当天有对话的两人：双向各更新一次，变化合并后受 ±8 封顶
 * - 当天无对话但已连续 3 天无互动：向 0 衰减 1
 */
export function planRelationUpdates({ townId, relations = [], dialogues = [], day }) {
  const dialoguesByPair = new Map();
  for (const dialogue of dialogues) {
    const [a, b] = dialogue?.participant_ids ?? [];
    if (!a || !b || a === b) continue;
    const key = pairKey(a, b);
    if (!dialoguesByPair.has(key)) dialoguesByPair.set(key, { a, b, list: [] });
    dialoguesByPair.get(key).list.push(dialogue);
  }

  const updates = [];

  for (const { a, b, list } of dialoguesByPair.values()) {
    const rawDelta = list.reduce((sum, dialogue) => sum + dialogueDelta(dialogue), 0);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const previous = relations.find(
        (relation) => relation.from_agent_id === from && relation.to_agent_id === to
      );
      updates.push({
        town_id: townId,
        from_agent_id: from,
        to_agent_id: to,
        ...nextRelation({ previous, delta: rawDelta, day }),
      });
    }
  }

  for (const relation of relations) {
    if (dialoguesByPair.has(pairKey(relation.from_agent_id, relation.to_agent_id))) continue;
    if (!shouldDecay(relation, day)) continue;
    const delta = decayDelta(relation.affinity);
    if (delta === 0) continue;
    updates.push({
      town_id: townId,
      from_agent_id: relation.from_agent_id,
      to_agent_id: relation.to_agent_id,
      ...nextRelation({ previous: relation, delta, day }),
    });
  }

  return updates;
}
