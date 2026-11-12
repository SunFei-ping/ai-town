/**
 * 把服务端 SSE tick 的结果落到本地 IndexedDB，并整理成与 runDay 一致的 outcome，
 * 供主界面复用同一套渲染逻辑。
 *
 * 服务端不存储小镇状态，所以这里负责：
 * 组装 tick 上下文 → 消费 SSE → 写计划/对话/独白/关系/小报/当日状态。
 */
import * as dao from '../storage/dao.js';
import { assembleContextFromDB } from '../../domain/memory/assemble.js';
import { createDialogueMemories, createEventMemory } from '../../domain/memory/tier.js';
import { compressDay } from '../../domain/memory/compress.js';
import { planRelationUpdates } from '../../domain/relation/rules.js';
import { streamTick } from './sse.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

const DEFAULT_WEATHER = '晴';

function toDialogue({ townId, day, frame }) {
  const participants = frame.participants ?? [];
  const rounds = frame.rounds ?? [];
  return {
    town_id: townId,
    day,
    hour: frame.hour,
    location: frame.location,
    initiator_agent_id: participants[0] ?? null,
    participant_ids: participants,
    transcript: rounds,
    rounds: rounds.length,
    truncated: false,
    disagreement: false,
  };
}

export async function runTickFromServer({
  town,
  agents,
  day,
  sessionToken,
  onStage,
  onWarning,
  generationMode = 'normal',
  lastTickAt,
  fetchImpl = globalThis.fetch,
}) {
  const startedAt = Date.now();
  const relations = await dao.listRelations(town.id);
  const context = await assembleContextFromDB({
    town: { ...town, day_index: day },
    day,
    agents,
    relations,
  });
  if (!context.day_state.weather) context.day_state.weather = DEFAULT_WEATHER;

  const plans = [];
  const dialogues = [];
  const unsays = [];
  const warnings = [];
  let report = null;
  let usage = null;
  let lastStage = null;

  const mark = (stage) => {
    if (lastStage === stage) return;
    lastStage = stage;
    onStage?.(stage);
  };

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  await streamTick({
    townId: town.id,
    dayIndex: day,
    context,
    sessionToken,
    fetchImpl,
    onFrame: (frame) => {
      if (frame.event === 'accepted') {
        mark('validating');
      } else if (frame.event === 'planning') {
        mark('planning');
        plans.push({
          agent_id: frame.data.agent_id,
          agent_name: agentById.get(frame.data.agent_id)?.name ?? '',
          plan: frame.data.plan ?? [],
          degraded: false,
        });
      } else if (frame.event === 'dialogue') {
        mark('simulating');
        dialogues.push(toDialogue({ townId: town.id, day, frame: frame.data }));
      } else if (frame.event === 'unsaid') {
        mark('reflecting');
        unsays.push({
          agent_id: frame.data.agent_id,
          agent_name: agentById.get(frame.data.agent_id)?.name ?? '',
          text: frame.data.text,
        });
      } else if (frame.event === 'report_ready') {
        mark('reporting');
        report = frame.data.report;
      } else if (frame.event === 'warning') {
        warnings.push(frame.data);
        onWarning?.(frame.data);
      } else if (frame.event === 'done') {
        usage = frame.data.usage ?? null;
        mark('done');
      }
    },
  });

  if (!report) {
    throw new AppError(ERROR_CODES.E_INTERNAL, '服务端没有返回小报');
  }
  // 补算产生的 tick 与手动 tick 走同一套逻辑，只在落库前标记生成模式
  if (generationMode === 'backfill' && report.generation_mode !== 'degraded') {
    report.generation_mode = 'backfill';
  }

  // 计划写回 AGENT
  const planByAgent = new Map(plans.map((entry) => [entry.agent_id, entry.plan]));
  for (const agent of agents) {
    await dao.putAgent({
      ...agent,
      plan_json: JSON.stringify(planByAgent.get(agent.id) ?? []),
    });
  }

  // 对话与双方事件层记忆
  for (const dialogue of dialogues) {
    const saved = await dao.saveDialogue(dialogue);
    for (const memory of createDialogueMemories({ dialogue: saved, agents })) {
      await dao.putMemory(memory);
    }
  }

  // 独白写入事件层，随后与对话一起压缩成当日总结
  for (const unsay of unsays) {
    await dao.putMemory(
      createEventMemory({
        agent_id: unsay.agent_id,
        content: unsay.text,
        created_day: day,
        weight: 6,
      })
    );
  }

  const summaries = await compressDay({ agents, day });

  // 关系值：与前端桩模式共用同一套规则
  const relationUpdates = planRelationUpdates({
    townId: town.id,
    relations,
    dialogues,
    day,
  });
  for (const update of relationUpdates) {
    await dao.putRelation(update);
  }

  if (!(await dao.getReport(town.id, day))) {
    await dao.saveReport(report);
  }

  const updatedTown = await dao.updateTownDay(town.id, day, { lastTickAt });
  const dayStatus = report.generation_mode === 'degraded' ? 'partial' : 'done';
  await dao.putDayState({
    town_id: town.id,
    day,
    weather: context.day_state.weather,
    user_event_id: null,
    status: dayStatus,
    started_at: startedAt,
    finished_at: Date.now(),
  });

  return {
    state: 'done',
    stages: lastStage ? ['validating', 'planning', 'simulating', 'reflecting', 'reporting', 'done'] : [],
    dayStatus,
    plans,
    dialogues,
    encounters: [],
    passedBy: [],
    relations: relationUpdates,
    unsays,
    summaries,
    report,
    warnings,
    usage,
    town: updatedTown,
  };
}
