/**
 * 数据访问层：负责 SPCD §6.4 的约束校验与级联删除。
 * 业务编排不放在这里，这里只保证「写进去的数据是合法的」。
 */
import * as db from './idb.js';
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { LIMITS, FIELD_LIMITS, PACE_MODES, MEMORY_TIERS } from '../../../shared/contracts/index.js';
import { newId } from '../../../shared/ids.js';

function assert(condition, message) {
  if (!condition) fail(ERROR_CODES.E_VALIDATION, message);
}

function assertLength(value, max, label) {
  assert(typeof value === 'string' && value.trim().length > 0, `${label}不能为空`);
  assert(value.length <= max, `${label}不能超过 ${max} 个字符`);
}

/* ------------------------------ 小镇 ------------------------------ */

export async function createTown({ name, templateId, paceMode }, agents) {
  assert(Array.isArray(agents) && agents.length === LIMITS.AGENTS_PER_TOWN, `一座小镇必须恰好 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  assert(PACE_MODES.includes(paceMode), '节奏模式不合法');
  assertLength(name, FIELD_LIMITS.TOWN_NAME_MAX, '小镇名');

  const names = new Set();
  for (const agent of agents) {
    assertLength(agent.name, FIELD_LIMITS.AGENT_NAME_MAX, '居民名');
    assert(!names.has(agent.name), `居民名重复：${agent.name}`);
    names.add(agent.name);
    assert(Number.isInteger(agent.age) && agent.age >= 1 && agent.age <= 120, '年龄必须在 1–120 之间');
  }

  const town = {
    id: newId('town'),
    name,
    template_id: templateId,
    pace_mode: paceMode,
    status: 'running',
    day_index: 0,
    created_at: Date.now(),
    last_tick_at: null,
    schema_version: '1.0.0',
  };

  await db.put('town', town);
  try {
    for (const agent of agents) {
      await db.put('agent', {
        id: newId('agent'),
        town_id: town.id,
        name: agent.name,
        age: agent.age,
        occupation: agent.occupation,
        persona: agent.persona,
        secret: agent.secret,
        conflict_goal: agent.conflict_goal,
        speech_style: agent.speech_style,
        current_location: null,
        plan_json: null,
      });
    }
  } catch (err) {
    await deleteTown(town.id);
    throw err;
  }

  return town;
}

export async function getTown(townId) {
  const town = await db.get('town', townId);
  if (!town) fail(ERROR_CODES.E_TOWN_STATE, '小镇不存在');
  return town;
}

export async function listAgents(townId) {
  return db.getAllByIndex('agent', 'by_town', townId);
}

/**
 * C2：day_index 单调不减，且不超过 7。
 */
export async function updateTownDay(townId, nextDay) {
  const town = await getTown(townId);
  assert(Number.isInteger(nextDay), '天数必须是整数');
  if (nextDay < town.day_index) {
    fail(ERROR_CODES.E_TOWN_STATE, `天数不能回退：${town.day_index} → ${nextDay}`);
  }
  if (nextDay > LIMITS.DAYS_PER_TOWN) {
    fail(ERROR_CODES.E_TOWN_STATE, `天数不能超过 ${LIMITS.DAYS_PER_TOWN}`);
  }
  const updated = {
    ...town,
    day_index: nextDay,
    last_tick_at: Date.now(),
    status: nextDay >= LIMITS.DAYS_PER_TOWN ? 'completed' : 'running',
  };
  await db.put('town', updated);
  return updated;
}

/* ------------------------------ 居民 ------------------------------ */

export async function putAgent(agent) {
  const town = await db.get('town', agent.town_id);
  if (!town) fail(ERROR_CODES.E_TOWN_STATE, '小镇不存在');
  return db.put('agent', agent);
}

/* ------------------------------ 关系 ------------------------------ */

/**
 * C8：关系两端必须属于同一座小镇。
 */
export async function putRelation(relation) {
  const from = await db.get('agent', relation.from_agent_id);
  const to = await db.get('agent', relation.to_agent_id);
  assert(Boolean(from) && Boolean(to), '关系两端的居民必须存在');
  if (from.town_id !== to.town_id) {
    fail(ERROR_CODES.E_VALIDATION, '关系两端的居民不属于同一小镇');
  }
  assert(relation.affinity >= -100 && relation.affinity <= 100, '关系值必须在 -100 到 100 之间');

  const existing = await db.getAllByIndex('relation', 'by_pair', [
    relation.from_agent_id,
    relation.to_agent_id,
  ]);
  const record = existing[0]
    ? { ...existing[0], ...relation, id: existing[0].id }
    : { id: newId('rel'), ...relation };
  return db.put('relation', record);
}

export async function listRelations(townId) {
  return db.getAllByIndex('relation', 'by_town', townId);
}

/* ------------------------------ 事件 ------------------------------ */

/**
 * C3：每人每天至多 1 条用户事件。
 */
export async function addEvent(event) {
  const sameDay = await db.getAllByIndex('event', 'by_town_day', [event.town_id, event.day]);
  if (event.source === 'user' && sameDay.some((e) => e.source === 'user')) {
    fail(ERROR_CODES.E_VALIDATION, '这一天已经投递过事件了');
  }
  const record = { id: newId('evt'), ...event };
  return db.put('event', record);
}

export async function listEvents(townId, day) {
  return db.getAllByIndex('event', 'by_town_day', [townId, day]);
}

/* ------------------------------ 记忆 ------------------------------ */

/**
 * C4：印象层对同一 target 只保留 1 条，写入即覆盖。
 */
export async function putMemory(memory) {
  assert(MEMORY_TIERS.includes(memory.tier), '记忆层级不合法');
  if (memory.tier === 'impression') {
    assert(Boolean(memory.target_agent_id), '印象层必须指定对象');
    const existing = await db.getAllByIndex('memory', 'by_agent_target', [
      memory.agent_id,
      memory.target_agent_id,
    ]);
    const sameTier = existing.find((m) => m.tier === 'impression');
    if (sameTier) {
      return db.put('memory', { ...sameTier, ...memory, id: sameTier.id });
    }
  }
  const record = { id: newId('mem'), weight: 5, ...memory };
  return db.put('memory', record);
}

export async function listMemories(agentId, tier) {
  return db.getAllByIndex('memory', 'by_agent_tier', [agentId, tier]);
}

/* ------------------------------ 当日状态 ------------------------------ */

export async function putDayState(state) {
  const existing = await db.getAllByIndex('day_state', 'by_town_day', [state.town_id, state.day]);
  const record = existing[0]
    ? { ...existing[0], ...state, id: existing[0].id }
    : { id: newId('day'), ...state };
  return db.put('day_state', record);
}

export async function getDayState(townId, day) {
  const rows = await db.getAllByIndex('day_state', 'by_town_day', [townId, day]);
  return rows[0] ?? null;
}

/* ------------------------------ 对话与用量 ------------------------------ */

export async function saveDialogue(dialogue) {
  const record = { id: newId('dlg'), ...dialogue };
  return db.put('dialogue', record);
}

export async function listDialogues(townId, day) {
  return db.getAllByIndex('dialogue', 'by_town_day_hour', [townId, day]);
}

export async function addUsage(usage) {
  const record = { id: newId('use'), ...usage };
  return db.put('usage', record);
}

export async function listUsage(townId, day) {
  return db.getAllByIndex('usage', 'by_town_day', [townId, day]);
}

/* ------------------------------ 级联删除 ------------------------------ */

export async function deleteTown(townId) {
  const agents = await listAgents(townId);
  for (const agent of agents) {
    await db.deleteByIndexPrefix('memory', 'by_agent_tier', [agent.id]);
  }

  const reports = await db.getAllByIndexPrefix('daily_report', 'by_town_day', [townId]);
  for (const report of reports) {
    await db.deleteByIndex('report_section', 'by_report', report.id);
    await db.deleteByIndex('unsay', 'by_report', report.id);
  }

  await db.deleteByIndex('agent', 'by_town', townId);
  await db.deleteByIndexPrefix('day_state', 'by_town_day', [townId]);
  await db.deleteByIndex('relation', 'by_town', townId);
  await db.deleteByIndexPrefix('event', 'by_town_day', [townId]);
  await db.deleteByIndexPrefix('dialogue', 'by_town_day_hour', [townId]);
  await db.deleteByIndexPrefix('daily_report', 'by_town_day', [townId]);
  await db.deleteByIndexPrefix('usage', 'by_town_day', [townId]);
  await db.del('town', townId);
}
