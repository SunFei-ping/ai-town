/**
 * 真实时间模式的补算与中断恢复，见 SPCD §8.8。
 *
 * 规则：
 * - 以 `last_tick_at` 为唯一基准折算可解锁天数 D，D 上限为剩余天数
 * - 单批最多补算 2 天，超出发 `W_BACKFILL_CAPPED`
 * - 每天完成立即落本地并回调渲染，不等全部结束
 * - 补算时 `last_tick_at` 按虚拟时间前进一天，未补完的天数留到下次打开继续
 */
import { LIMITS } from '../../../shared/contracts/index.js';
import { ERROR_CODES, WARNING_CODES, WARNING_MESSAGES } from '../../../shared/errors/codes.js';
import { fail } from '../../../shared/errors/app-error.js';

/** 真实时间模式下，1 个小镇日对应的真实时长（初始值） */
export const REALTIME_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 纯函数：计算本次可补算的天数。
 * @returns {{unlocked:number,batch:number,capped:boolean,remaining:number,dayMs:number,base:number}}
 */
export function computeBackfillPlan({
  town,
  now = Date.now(),
  dayMs = REALTIME_DAY_MS,
  batchDays = LIMITS.BACKFILL_BATCH_DAYS,
} = {}) {
  const empty = { unlocked: 0, batch: 0, capped: false, remaining: 0, dayMs, base: now };
  if (!town || town.pace_mode !== 'realtime' || town.status !== 'running') return empty;
  if (!Number.isFinite(dayMs) || dayMs <= 0) return empty;

  const left = LIMITS.DAYS_PER_TOWN - (Number(town.day_index) || 0);
  if (left <= 0) return empty;

  const base = Number(town.last_tick_at ?? town.created_at ?? now);
  const elapsed = Math.max(0, Number(now) - base);
  const unlocked = Math.min(Math.floor(elapsed / dayMs), left);
  const batch = Math.min(unlocked, Math.max(0, Number(batchDays) || 0));

  return {
    unlocked,
    batch,
    capped: unlocked > batch,
    remaining: unlocked - batch,
    dayMs,
    base,
  };
}

/**
 * 执行一批补算。
 *
 * `advanceDay({ town, day, lastTickAt })` 由调用方注入：桩模型与真实模型共用本流程。
 * 返回的 outcome 必须含更新后的 `town`。
 */
export async function runBackfill({
  town,
  now = Date.now(),
  dayMs = REALTIME_DAY_MS,
  batchDays = LIMITS.BACKFILL_BATCH_DAYS,
  advanceDay,
  onDayDone,
  onWarning,
} = {}) {
  if (typeof advanceDay !== 'function') {
    fail(ERROR_CODES.E_VALIDATION, '补算需要注入 advanceDay');
  }

  const plan = computeBackfillPlan({ town, now, dayMs, batchDays });
  if (plan.capped) {
    onWarning?.({
      code: WARNING_CODES.W_BACKFILL_CAPPED,
      message: WARNING_MESSAGES[WARNING_CODES.W_BACKFILL_CAPPED],
    });
  }

  let current = town;
  let completed = 0;
  const outcomes = [];

  for (let index = 0; index < plan.batch; index += 1) {
    const day = (Number(current.day_index) || 0) + 1;
    if (day > LIMITS.DAYS_PER_TOWN) break;

    const base = Number(current.last_tick_at ?? current.created_at ?? now);
    const lastTickAt = base + dayMs;
    const outcome = await advanceDay({ town: current, day, lastTickAt });

    current = outcome?.town ?? {
      ...current,
      day_index: day,
      last_tick_at: lastTickAt,
    };
    completed += 1;
    outcomes.push(outcome);
    await onDayDone?.(outcome, { day, completed, batch: plan.batch });
  }

  return {
    ...plan,
    completed,
    outcomes,
    town: current,
    remaining: Math.max(0, plan.unlocked - completed),
  };
}
