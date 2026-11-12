/**
 * 单日编排（M1 版：1 个居民、无相遇、无小报）。
 * 完整流程见 SPCD §8.3，缺少的部分由 M2 / M4 补齐。
 */
import { TickMachine } from './tick-machine.js';
import { generatePlan } from '../agent/plan.js';
import { generateUnsay } from '../agent/unsay.js';
import * as dao from '../../infra/storage/dao.js';
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { LIMITS } from '../../../shared/contracts/index.js';

const DEFAULT_WEATHER = '晴';

export async function runDay({ town, agent, day, model, onStage }) {
  if (town.status !== 'running') {
    fail(ERROR_CODES.E_TOWN_STATE, '小镇当前状态不能推进');
  }
  if (day !== town.day_index + 1) {
    fail(ERROR_CODES.E_TOWN_STATE, `只能推进到下一天：期望 ${town.day_index + 1}，收到 ${day}`);
  }
  if (day > LIMITS.DAYS_PER_TOWN) {
    fail(ERROR_CODES.E_TOWN_STATE, '已经到第七天');
  }

  const machine = new TickMachine('idle', (state) => onStage?.(state));
  const startedAt = Date.now();

  machine.to('validating');
  machine.to('planning');

  let plan = [];
  try {
    plan = await generatePlan({ model, town, agent, day });
  } catch {
    machine.to('degraded');
  }

  if (!machine.degraded) machine.to('simulating');

  await dao.putDayState({
    town_id: town.id,
    day,
    weather: DEFAULT_WEATHER,
    user_event_id: null,
    status: 'running',
    started_at: startedAt,
    finished_at: null,
  });

  let unsay = null;
  if (!machine.degraded) {
    machine.to('reflecting');
    try {
      unsay = await generateUnsay({ model, town, agent, day });
    } catch {
      machine.to('degraded');
    }
  }

  machine.to('reporting');

  if (plan.length > 0) {
    await dao.putAgent({
      ...agent,
      plan_json: JSON.stringify(plan),
      current_location: plan[0]?.location ?? null,
    });
  }

  if (unsay) {
    await dao.putMemory({
      agent_id: agent.id,
      tier: 'event',
      content: unsay,
      target_agent_id: null,
      weight: 6,
      created_day: day,
      expire_day: day,
    });
  }

  machine.to('done');

  const updatedTown = await dao.updateTownDay(town.id, day);

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
    plan,
    unsay,
    town: updatedTown,
  };
}
