/**
 * 位置推进与相遇判定，对应 SPCD §8.3 / §8.4。
 * 纯函数：输入 5 人计划，输出逐小时位置、相遇与「擦肩而过」。
 */
import { LIMITS } from '../../../shared/contracts/index.js';

/**
 * 取某小时所在的位置：使用 hour <= 当前小时的最后一个时间段。
 * 没到第一个时间段时返回 null（尚未出门）。
 */
export function locationAt(plan, hour) {
  if (!Array.isArray(plan)) return null;
  let current = null;
  for (const item of plan) {
    if (!item || typeof item.hour !== 'number') continue;
    if (item.hour > hour) continue;
    if (!current || item.hour >= current.hour) current = item;
  }
  return current;
}

function planMap(plans) {
  const map = new Map();
  for (const entry of plans ?? []) {
    if (entry?.agent_id && Array.isArray(entry.plan)) map.set(entry.agent_id, entry.plan);
  }
  return map;
}

/**
 * 某一小时所有居民的位置。order 用于同一时刻到达时的稳定排序。
 */
export function positionsAtHour(agents, plans, hour) {
  const map = planMap(plans);
  const positions = [];
  agents.forEach((agent, index) => {
    const segment = locationAt(map.get(agent.id), hour);
    if (!segment) return;
    positions.push({
      agent_id: agent.id,
      agent_name: agent.name,
      location: segment.location,
      arrival_hour: segment.hour,
      order: index,
    });
  });
  return positions;
}

/** 计划中出现的全部小时（升序），逐小时推进的基础 */
export function planHours(plans) {
  const hours = new Set();
  for (const entry of plans ?? []) {
    for (const item of entry.plan ?? []) {
      if (Number.isInteger(item?.hour)) hours.add(item.hour);
    }
  }
  return [...hours].sort((a, b) => a - b);
}

export function buildTimeline({ agents, plans }) {
  return planHours(plans).map((hour) => ({
    hour,
    positions: positionsAtHour(agents, plans, hour),
  }));
}

/**
 * 同一地点的 2 人及以上触发一段相遇。
 * 同一小时最多保留 maxPerHour 段，其余记为「擦肩而过」。
 * 先到者：arrival_hour 更早的人优先，其次按居民顺序。
 */
export function resolveEncounters(positions, { maxPerHour = LIMITS.MAX_DIALOGUES_PER_HOUR } = {}) {
  const groups = new Map();
  for (const position of positions) {
    if (!groups.has(position.location)) groups.set(position.location, []);
    groups.get(position.location).push(position);
  }

  const candidates = [];
  for (const [location, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => a.arrival_hour - b.arrival_hour || a.order - b.order
    );
    candidates.push({
      location,
      agent_ids: sorted.map((member) => member.agent_id),
      initiator_id: sorted[0].agent_id,
      participant_ids: [sorted[0].agent_id, sorted[1].agent_id],
      arrival_hour: sorted[0].arrival_hour,
    });
  }

  candidates.sort(
    (a, b) =>
      b.agent_ids.length - a.agent_ids.length ||
      a.arrival_hour - b.arrival_hour ||
      a.location.localeCompare(b.location, 'zh-CN')
  );

  const encounters = candidates.slice(0, maxPerHour);
  const passedBy = candidates.slice(maxPerHour).map((candidate) => ({
    location: candidate.location,
    agent_ids: candidate.agent_ids,
    initiator_id: candidate.initiator_id,
    reason: 'hour_cap',
  }));

  return { encounters, passedBy };
}

/** 全天逐小时推进，返回时间线、相遇与擦肩而过 */
export function collectEncounters({ agents, plans, maxPerHour }) {
  const timeline = buildTimeline({ agents, plans });
  const encounters = [];
  const passedBy = [];

  for (const { hour, positions } of timeline) {
    const result = resolveEncounters(positions, { maxPerHour });
    for (const encounter of result.encounters) encounters.push({ hour, ...encounter });
    for (const pass of result.passedBy) passedBy.push({ hour, ...pass });
  }

  return { timeline, encounters, passedBy };
}
