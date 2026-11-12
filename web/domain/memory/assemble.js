/**
 * Tick 上下文组装与截断，对应 SPCD §7.3 / §8.6。
 *
 * 组装顺序（高 → 低优先级）：
 *   人设 / 印象层 / 总结层 / 当日事件层 / 用户事件与天气
 * 超过 max_context_tokens 时从低优先级开始丢：
 *   先丢 3 天前的总结层，再丢非在场者的印象层。
 */
import * as dao from '../../infra/storage/dao.js';
import { LIMITS } from '../../../shared/contracts/index.js';
import { estimateTokens } from '../../../shared/contracts/tick-context.js';

function parsePlan(planJson) {
  try {
    const plan = JSON.parse(planJson ?? '[]');
    return Array.isArray(plan) ? plan : [];
  } catch {
    return [];
  }
}

/** 把记忆记录整理为 §7.3 的 memories 结构 */
export function toMemoriesView(memories = [], day) {
  const impressions = [];
  const summaries = [];
  const todayEvents = [];

  for (const memory of memories) {
    if (memory.tier === 'impression') {
      impressions.push({
        target_agent_id: memory.target_agent_id,
        content: memory.content,
      });
    } else if (memory.tier === 'summary') {
      summaries.push({ day: memory.created_day, content: memory.content });
    } else if (memory.tier === 'event' && memory.created_day === day) {
      todayEvents.push({ content: memory.content });
    }
  }

  summaries.sort((a, b) => a.day - b.day);
  return { impressions, summaries, today_events: todayEvents };
}

function memoriesOf(memoriesByAgent, agentId) {
  if (memoriesByAgent instanceof Map) return memoriesByAgent.get(agentId) ?? [];
  return memoriesByAgent?.[agentId] ?? [];
}

/** 纯函数：按契约结构组装上下文 */
export function assembleContext({
  town,
  day,
  agents,
  relations = [],
  dayState = {},
  memoriesByAgent = {},
  limits = {},
  presentAgentIds,
}) {
  const context = {
    town: {
      id: town.id,
      name: town.name,
      pace_mode: town.pace_mode,
      day_index: town.day_index,
      template_id: town.template_id,
    },
    day_state: {
      weather: dayState.weather ?? '',
      user_event: dayState.user_event ?? null,
    },
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      age: agent.age,
      occupation: agent.occupation,
      persona: agent.persona,
      secret: agent.secret,
      conflict_goal: agent.conflict_goal,
      speech_style: agent.speech_style,
      current_location: agent.current_location ?? null,
      plan: parsePlan(agent.plan_json),
      memories: toMemoriesView(memoriesOf(memoriesByAgent, agent.id), day),
    })),
    relations: relations.map((relation) => ({
      from_agent_id: relation.from_agent_id,
      to_agent_id: relation.to_agent_id,
      affinity: relation.affinity,
      label: relation.label,
    })),
    limits: {
      max_dialogue_rounds: limits.max_dialogue_rounds ?? LIMITS.MAX_DIALOGUE_ROUNDS,
      max_context_tokens: limits.max_context_tokens ?? LIMITS.CTX_TOKEN_LIMIT,
      budget_remaining_yuan: limits.budget_remaining_yuan ?? LIMITS.BUDGET_PER_TOWN_YUAN,
    },
  };

  return truncateContext(context, {
    maxTokens: context.limits.max_context_tokens,
    presentAgentIds,
  });
}

function cloneContext(context) {
  return {
    ...context,
    day_state: { ...context.day_state },
    agents: context.agents.map((agent) => ({
      ...agent,
      plan: [...agent.plan],
      memories: {
        impressions: agent.memories.impressions.map((item) => ({ ...item })),
        summaries: agent.memories.summaries.map((item) => ({ ...item })),
        today_events: agent.memories.today_events.map((item) => ({ ...item })),
      },
    })),
    relations: context.relations.map((item) => ({ ...item })),
    limits: { ...context.limits },
  };
}

/** 纯函数：按 §8.6 的截断顺序收敛上下文 */
export function truncateContext(context, { maxTokens, presentAgentIds } = {}) {
  const limit = maxTokens ?? context.limits?.max_context_tokens ?? LIMITS.CTX_TOKEN_LIMIT;
  const working = cloneContext(context);
  if (estimateTokens(working) <= limit) return working;

  // 第一步：丢 3 天前的总结层（只保留最近 2 天）
  const cutoff = (working.town?.day_index ?? 0) - 2;
  for (const agent of working.agents) {
    agent.memories.summaries = agent.memories.summaries.filter(
      (summary) => summary.day >= cutoff
    );
  }
  if (estimateTokens(working) <= limit) return working;

  // 第二步：丢非在场者的印象层
  if (presentAgentIds) {
    const present = new Set(presentAgentIds);
    for (const agent of working.agents) {
      agent.memories.impressions = agent.memories.impressions.filter((impression) =>
        present.has(impression.target_agent_id)
      );
    }
  }

  return working;
}

/** 从 IndexedDB 读取记忆、关系与当日事件后组装上下文 */
export async function assembleContextFromDB({
  town,
  day,
  agents,
  relations,
  dayState,
  limits,
  presentAgentIds,
}) {
  const resolvedRelations = relations ?? (await dao.listRelations(town.id));
  const resolvedState = dayState ?? (await dao.getDayState(town.id, day));
  const events = await dao.listEvents(town.id, day);
  const userEvent = events.find((event) => event.source === 'user');

  const memoriesByAgent = {};
  for (const agent of agents) {
    memoriesByAgent[agent.id] = await dao.listAllMemories(agent.id);
  }

  return assembleContext({
    town,
    day,
    agents,
    relations: resolvedRelations,
    dayState: {
      weather: resolvedState?.weather ?? '',
      user_event: userEvent ? { type: userEvent.type, payload: userEvent.payload } : null,
    },
    memoriesByAgent,
    limits,
    presentAgentIds,
  });
}
