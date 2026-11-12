/**
 * 成本护栏，见 SPCD §8.7 / §10.4。
 * 每次模型调用累计折算金额；超过单局护栏后只降级（减少轮次、压缩记忆），不中断。
 */
import { LIMITS } from '../../shared/contracts/index.js';
import { WARNING_CODES, WARNING_MESSAGES } from '../../shared/errors/codes.js';
import { DEFAULT_PRICES, usageCost } from '../model/index.js';

export function createBudgetGuard({ budgetYuan = LIMITS.BUDGET_PER_TOWN_YUAN, prices = DEFAULT_PRICES } = {}) {
  let spent = 0;
  let triggered = false;

  return {
    record(usage) {
      spent += usageCost(usage, prices);
      if (!triggered && spent >= budgetYuan) {
        triggered = true;
        return {
          triggered: true,
          warning: {
            code: WARNING_CODES.W_BUDGET_GUARD,
            message: WARNING_MESSAGES.W_BUDGET_GUARD,
          },
        };
      }
      return { triggered: false, warning: null };
    },
    get spent() {
      return spent;
    },
    get triggered() {
      return triggered;
    },
    get budgetYuan() {
      return budgetYuan;
    },
    get remaining() {
      return Math.max(0, budgetYuan - spent);
    },
  };
}
