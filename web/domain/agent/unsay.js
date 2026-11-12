/**
 * 每日一句「没说出口的话」。
 * 这是小报的传播点，SPCD §8.3 的最后一个阶段。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

export function validateUnsay(result) {
  const text = result?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    fail(ERROR_CODES.E_MODEL_OUTPUT, '独白内容为空');
  }
  if (text.length > 120) {
    fail(ERROR_CODES.E_MODEL_OUTPUT, '独白超过 120 字');
  }
  return text;
}

export async function generateUnsay({ model, town, agent, day }) {
  const result = await model.complete({ stage: 'unsay', town, agent, day });
  return validateUnsay(result);
}
