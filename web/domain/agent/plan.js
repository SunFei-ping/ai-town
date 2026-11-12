/**
 * 当日计划的生成与校验。
 * 计划是一天的时间段数组，供相遇判定使用（SPCD §8.3 / §8.4）。
 * M2 起 5 个居民并行生成；单条失败重试 1 次后使用模板计划（SPCD §8.7）。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES, WARNING_CODES } from '../../../shared/errors/codes.js';

const REQUIRED_FIELDS = ['hour', 'location', 'intent'];

export function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    fail(ERROR_CODES.E_MODEL_OUTPUT, '计划必须是非空数组');
  }
  for (const item of plan) {
    for (const field of REQUIRED_FIELDS) {
      if (item?.[field] === undefined || item[field] === null || item[field] === '') {
        fail(ERROR_CODES.E_MODEL_OUTPUT, `计划缺少字段 ${field}`);
      }
    }
    if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > 23) {
      fail(ERROR_CODES.E_MODEL_OUTPUT, '计划中的 hour 必须是 0–23 的整数');
    }
  }
  return plan;
}

export async function generatePlan({ model, town, agent, day, context }) {
  const result = await model.complete({ stage: 'plan', town, agent, day, context });
  return validatePlan(result?.plan);
}

/**
 * 模板降级计划：模型连续失败时使用，保证当天仍可推进。
 * 内容只依赖居民自身字段，不触网、结果确定。
 */
export function fallbackPlan(agent) {
  const place = agent.occupation || '街上';
  return [
    { hour: 7, location: place, intent: '开门' },
    { hour: 11, location: place, intent: '做事' },
    { hour: 15, location: '街上', intent: '走动' },
    { hour: 19, location: place, intent: '收尾' },
  ];
}

async function generateOnePlan({ model, town, agent, day, context, onWarning }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const plan = await generatePlan({ model, town, agent, day, context });
      return { agent_id: agent.id, agent_name: agent.name, plan, degraded: false };
    } catch {
      /* 重试一次；仍失败走模板计划 */
    }
  }

  onWarning?.({
    code: WARNING_CODES.W_STAGE_DEGRADED,
    message: `${agent.name} 的计划生成失败，已使用模板计划`,
  });
  return {
    agent_id: agent.id,
    agent_name: agent.name,
    plan: fallbackPlan(agent),
    degraded: true,
  };
}

/**
 * 5 人并行生成当日计划，返回值顺序与 agents 一致，且保证条数不变。
 */
export async function generatePlans({ model, town, agents, day, context, onWarning }) {
  if (!Array.isArray(agents) || agents.length === 0) {
    fail(ERROR_CODES.E_VALIDATION, '生成计划至少需要 1 个居民');
  }
  return Promise.all(
    agents.map((agent) => generateOnePlan({ model, town, agent, day, context, onWarning }))
  );
}
