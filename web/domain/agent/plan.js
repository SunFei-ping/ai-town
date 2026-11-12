/**
 * 当日计划的生成与校验。
 * 计划是一天的时间段数组，供相遇判定使用（SPCD §8.3 / §8.4）。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

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

export async function generatePlan({ model, town, agent, day }) {
  const result = await model.complete({ stage: 'plan', town, agent, day });
  return validatePlan(result?.plan);
}
