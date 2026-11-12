/**
 * 位置推进与相遇判定，对应 SPCD §8.3 / §8.4。
 * 纯函数：输入 5 人计划，输出逐小时位置、相遇与「擦肩而过」。
 */
import { LIMITS } from '../../../shared/contracts/index.js';

/**
 * 地点归一化：不同居民会把同一个地方写成不同说法
 *（「五金店卷帘门前」/「五金店柜台后」、「镇口面馆」/「镇上国道边的面馆」）。
 * 相遇判定按归一化后的地点分组，而不是要求字符串完全相等。
 */
const PLACE_ALIASES = [
  { pattern: /五金店|五金铺/g, canonical: '五金店' },
  { pattern: /咖啡店|咖啡馆|咖啡厅/g, canonical: '咖啡店' },
  { pattern: /面馆|面店|面摊/g, canonical: '面馆' },
  { pattern: /早餐摊|早点摊|早餐店|早点店/g, canonical: '早餐摊' },
  { pattern: /菜市场|菜场|菜摊/g, canonical: '菜市场' },
  { pattern: /小卖部|便利店|杂货铺/g, canonical: '小卖部' },
  { pattern: /小学|学校/g, canonical: '学校' },
  { pattern: /医院|卫生院/g, canonical: '医院' },
  { pattern: /邮局|邮政局/g, canonical: '邮局' },
  { pattern: /修车铺|修车店/g, canonical: '修车铺' },
  { pattern: /停车场|车场/g, canonical: '停车场' },
  { pattern: /码头|渡口/g, canonical: '码头' },
];

const LOCATION_PREFIXES =
  /^(在|去|到|从|镇上|镇口|镇东|镇西|镇南|镇北|街口|巷口|村口|邻镇|县道|国道|北边|南边|东边|西边|小区|自家|家里|家中|自己)/;

const LOCATION_SUFFIXES =
  /(卷帘门前|卷帘门|门口|门前|柜台后|柜台前|柜台|吧台|后厨|店内|店里|里屋|后屋|楼上|楼下|台阶|旁边|对面|边上|角落的小桌|角落|小桌旁|小桌|书桌前|书桌旁|操场边|院子里|院子)$/;

/**
 * 「家」「客厅」这类地点属于私人空间，不能把不同居民的家合并成一个地点。
 * 这类地点的分组键会带上 agent_id，只用于位置推进，不产生相遇。
 */
const PRIVATE_LOCATION_PATTERN =
  /^(家|自家|自己家|家庭|房间|卧室|客厅|厨房|小院|院子|饭桌|餐桌|床|楼上|楼下|门口|台阶)/;

export function normalizeLocation(location) {
  const raw = String(location ?? '').trim();
  if (!raw) return '';

  const cleaned = raw.replace(/[，。！？、；：\s]/g, '');
  const matches = [];
  for (const { pattern, canonical } of PLACE_ALIASES) {
    pattern.lastIndex = 0;
    let match = pattern.exec(cleaned);
    while (match) {
      matches.push({ end: match.index + match[0].length, canonical });
      match = pattern.exec(cleaned);
    }
  }

  // 取最靠近句尾的地点词作为核心地点（「学校门口的小卖部」应归到小卖部）
  if (matches.length > 0) {
    matches.sort((a, b) => a.end - b.end);
    return matches[matches.length - 1].canonical;
  }

  let core = cleaned
    .replace(LOCATION_PREFIXES, '')
    .replace(/^[^的]{1,8}的/, '')
    .replace(LOCATION_SUFFIXES, '');
  core = core.replace(/^的/, '');
  return core || cleaned;
}

/** 相遇分组键：公共地点归一化合并，私人地点按居民隔离 */
export function encounterLocationKey(agentId, location) {
  const normalized = normalizeLocation(location);
  if (PRIVATE_LOCATION_PATTERN.test(normalized)) {
    return `__private__:${agentId}:${normalized}`;
  }
  return normalized;
}

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
    const key = encounterLocationKey(position.agent_id, position.location);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(position);
  }

  const candidates = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => a.arrival_hour - b.arrival_hour || a.order - b.order
    );
    candidates.push({
      location: sorted[0].location,
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

/**
 * §12.3 要求：每份小报至少包含 1 条关系变化，因此一天至少要有一次相遇。
 * 若真实模型的计划完全没有交集，就挑一个最常用的公共地点，把前两位居民
 * 在 12 点各加一段「顺路停一下」，保证当天仍有一段对话可写。
 */
export function ensureDailyEncounter({ agents, plans, hour = 12 }) {
  const existing = collectEncounters({ agents, plans });
  if (existing.encounters.length > 0) {
    return { plans, encounters: existing.encounters, injected: false };
  }

  const counts = new Map();
  for (const entry of plans) {
    for (const segment of entry.plan ?? []) {
      const normalized = normalizeLocation(segment?.location);
      if (!normalized) continue;
      if (PRIVATE_LOCATION_PATTERN.test(normalized)) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  const location =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))[0]?.[0] ??
    '街口';

  const targets = new Set(plans.slice(0, 2).map((entry) => entry.agent_id));
  const nextPlans = plans.map((entry) => {
    if (!targets.has(entry.agent_id)) return entry;
    const plan = (entry.plan ?? []).filter((segment) => segment?.hour !== hour);
    plan.push({ hour, location, intent: '顺路停一下，和人说几句话' });
    plan.sort((a, b) => a.hour - b.hour);
    return { ...entry, plan };
  });

  const ensured = collectEncounters({ agents, plans: nextPlans });
  return { plans: nextPlans, encounters: ensured.encounters, injected: true };
}
