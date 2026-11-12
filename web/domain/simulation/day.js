/**
 * 单日编排（M4 版：5 个居民、逐小时相遇、对话、关系值、记忆三层、secret 检测与小报）。
 * 完整流程见 SPCD §8.3。
 */
import { TickMachine } from './tick-machine.js';
import { generatePlans } from '../agent/plan.js';
import { generateUnsay } from '../agent/unsay.js';
import { ensureUnsays } from '../report/unsay.js';
import { generateReport } from '../report/builder.js';
import { collectEncounters } from './encounter.js';
import { generateDialogue } from './dialogue.js';
import { createDialogueMemories, createEventMemory } from '../memory/tier.js';
import { assembleContextFromDB } from '../memory/assemble.js';
import { compressDay } from '../memory/compress.js';
import { guardDialogue, guardText, writeGuardUsage } from '../memory/secretGuard.js';
import { planRelationUpdates } from '../relation/rules.js';
import * as dao from '../../infra/storage/dao.js';
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES, WARNING_CODES } from '../../../shared/errors/codes.js';
import { LIMITS } from '../../../shared/contracts/index.js';

const DEFAULT_WEATHER = '晴';

export async function runDay({
  town,
  agents,
  day,
  model,
  onStage,
  onWarning,
  generationMode = 'normal',
  lastTickAt,
}) {
  if (town.status !== 'running') {
    fail(ERROR_CODES.E_TOWN_STATE, '小镇当前状态不能推进');
  }
  if (day !== town.day_index + 1) {
    fail(ERROR_CODES.E_TOWN_STATE, `只能推进到下一天：期望 ${town.day_index + 1}，收到 ${day}`);
  }
  if (day > LIMITS.DAYS_PER_TOWN) {
    fail(ERROR_CODES.E_TOWN_STATE, '已经到第七天');
  }
  if (!Array.isArray(agents) || agents.length !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `一座小镇必须恰好 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }

  const warnings = [];
  const notify = (code, message) => {
    const warning = { code, message };
    warnings.push(warning);
    onWarning?.(warning);
  };

  const machine = new TickMachine('idle', (state) => onStage?.(state));
  const startedAt = Date.now();

  machine.to('validating');
  machine.to('planning');

  // 计划和对话都在组装好的上下文里进行：印象层 + 总结层 + 关系 + 当日事件
  const previousRelations = await dao.listRelations(town.id);
  const context = await assembleContextFromDB({
    town,
    day,
    agents,
    relations: previousRelations,
  });
  const secrets = agents.map((agent) => agent.secret);

  const plans = await generatePlans({
    model,
    town,
    agents,
    day,
    context,
    onWarning: (warning) => notify(warning.code, warning.message),
  });
  const planByAgent = new Map(plans.map((entry) => [entry.agent_id, entry]));

  // 计划落库；current_location 在下面的逐小时推进中写入
  const records = new Map();
  for (const agent of agents) {
    const record = {
      ...agent,
      plan_json: JSON.stringify(planByAgent.get(agent.id)?.plan ?? []),
      current_location: null,
    };
    records.set(agent.id, record);
    await dao.putAgent(record);
  }

  machine.to('simulating');

  await dao.putDayState({
    town_id: town.id,
    day,
    weather: DEFAULT_WEATHER,
    user_event_id: null,
    status: 'running',
    started_at: startedAt,
    finished_at: null,
  });

  const { timeline, encounters, passedBy } = collectEncounters({ agents, plans });

  // 按小时推进位置：只在位置变化时落库
  for (const { positions } of timeline) {
    for (const position of positions) {
      const record = records.get(position.agent_id);
      if (!record || record.current_location === position.location) continue;
      record.current_location = position.location;
      await dao.putAgent(record);
    }
  }

  // 相遇 → 对话 → 双方事件层记忆
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const dialogues = [];
  let degraded = false;

  for (const encounter of encounters) {
    const first = agentById.get(encounter.participant_ids[0]);
    const second = agentById.get(encounter.participant_ids[1]);
    if (!first || !second) continue;
    try {
      const dialogue = await generateDialogue({
        model,
        town,
        encounter,
        initiator: first,
        partner: second,
        day,
        context,
      });
      // C5：secret 不得进入对话正文
      const guarded = await guardDialogue({ dialogue, secrets });
      await writeGuardUsage({
        townId: town.id,
        day,
        stage: 'dialogue',
        usage: guarded.usage,
      });

      const saved = await dao.saveDialogue(guarded.dialogue);
      dialogues.push(saved);
      for (const memory of createDialogueMemories({ dialogue: saved, agents })) {
        await dao.putMemory(memory);
      }
    } catch {
      degraded = true;
      notify(WARNING_CODES.W_STAGE_DEGRADED, `${first.name}和${second.name}的对话生成失败，已跳过`);
    }
  }

  // 单小时超出 2 段相遇的部分，记为「擦肩而过」写入事件层
  for (const pass of passedBy) {
    for (const agentId of pass.agent_ids) {
      await dao.putMemory(
        createEventMemory({
          agent_id: agentId,
          content: `在${pass.location}和别人擦肩而过，没说上话。`,
          created_day: day,
          weight: 3,
        })
      );
    }
  }

  // 关系值：有对话的两人更新，连续无互动的衰减
  const relationUpdates = planRelationUpdates({
    townId: town.id,
    relations: previousRelations,
    dialogues,
    day,
  });
  for (const update of relationUpdates) {
    await dao.putRelation(update);
  }

  machine.to('reflecting');

  // 每人一句未说出口的话；单点失败不阻塞当天
  const unsayResults = await Promise.allSettled(
    agents.map((agent) => generateUnsay({ model, town, agent, day, context }))
  );
  const unsays = [];
  unsayResults.forEach((result, index) => {
    const agent = agents[index];
    if (result.status === 'fulfilled') {
      unsays.push({ agent_id: agent.id, agent_name: agent.name, text: result.value });
    } else {
      degraded = true;
      notify(WARNING_CODES.W_STAGE_DEGRADED, `${agent.name}的独白生成失败，已跳过`);
    }
  });

  for (const unsay of unsays) {
    // C5：独白同样不得泄露 secret
    const guarded = await guardText({ text: unsay.text, secrets });
    unsay.text = guarded.text;
    await writeGuardUsage({
      townId: town.id,
      day,
      stage: 'unsay',
      usage: guarded.usage,
    });

    await dao.putMemory(
      createEventMemory({
        agent_id: unsay.agent_id,
        content: unsay.text,
        created_day: day,
        weight: 6,
      })
    );
  }

  // 记忆压缩：当天事件层 → 1 条总结层，原文丢弃（§8.6）
  const summaries = await compressDay({ agents, day });

  // C6：补齐 5 条 unsaid，缺失重建最多 2 次，仍缺失则降级
  const ensured = await ensureUnsays({
    agents,
    unsays,
    regenerate: async (agent) => {
      const text = await generateUnsay({ model, town, agent, day, context });
      const guarded = await guardText({ text, secrets });
      await writeGuardUsage({
        townId: town.id,
        day,
        stage: 'unsay',
        usage: guarded.usage,
      });
      return guarded.text;
    },
  });
  if (ensured.degraded) {
    degraded = true;
    notify(WARNING_CODES.W_REPORT_PARTIAL, '有居民没说出口的话缺失，小报已用兜底句补齐');
  }

  if (degraded) machine.to('degraded');
  machine.to('reporting');

  // 小报：四类版块 + 5 条 unsaid，落库并保证 (town_id, day) 唯一
  const report = await generateReport({
    town,
    day,
    agents,
    unsays: ensured.unsays,
    dialogues,
    previousRelations,
    relationUpdates,
    generationMode: degraded ? 'degraded' : generationMode,
  });

  machine.to('done');

  const updatedTown = await dao.updateTownDay(town.id, day, { lastTickAt });

  await dao.putDayState({
    town_id: town.id,
    day,
    weather: DEFAULT_WEATHER,
    user_event_id: null,
    status: machine.dayStatus(),
    started_at: startedAt,
    finished_at: Date.now(),
  });

  return {
    state: machine.state,
    stages: machine.history,
    dayStatus: machine.dayStatus(),
    plans,
    dialogues,
    encounters,
    passedBy,
    relations: relationUpdates,
    unsays: ensured.unsays,
    summaries,
    report,
    warnings,
    town: updatedTown,
  };
}
