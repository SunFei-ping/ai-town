/**
 * 关系标签映射，对应 SPCD §8.5。
 * 展示时把 friend 与 familiar 都归为「熟」，共三态：熟 / 生 / 有结。
 */
import { RELATION_LABELS } from '../../../shared/contracts/index.js';

/** 三态分类：用于关系图着色与图例 */
export const LABEL_STATE = Object.freeze({
  stranger: 'stranger',
  familiar: 'familiar',
  friend: 'familiar',
  knot: 'knot',
});

/** 三态文案 */
export const LABEL_TEXT = Object.freeze({
  stranger: '生',
  familiar: '熟',
  friend: '熟',
  knot: '有结',
});

/**
 * affinity ≥ 50 且持续 2 天 → friend；
 * affinity ≤ -40 → knot；
 * |affinity| < 10 → stranger；
 * 其余 → familiar。
 *
 * friendStreak 表示亲和值连续 ≥50 的天数（由调用方按天累计）。
 */
export function labelForAffinity(affinity, friendStreak = 0) {
  let label;
  if (affinity <= -40) label = 'knot';
  else if (affinity >= 50) label = friendStreak >= 2 ? 'friend' : 'familiar';
  else if (Math.abs(affinity) < 10) label = 'stranger';
  else label = 'familiar';

  if (!RELATION_LABELS.includes(label)) {
    throw new Error(`未知的关系标签：${label}`);
  }
  return label;
}
