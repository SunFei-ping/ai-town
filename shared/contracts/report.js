/**
 * 小报结构契约，唯一事实源，见 SPCD §6.2 / §12.3。
 *
 * DAILY_REPORT 每天一条，`(town_id, day)` 唯一；
 * REPORT_SECTION.kind ∈ headline / scene / relation / unsaid，四类各一条；
 * UNSAY 每份小报固定 5 条，与 5 个居民一一对应（C6）。
 */
import { SECTION_KINDS, REPORT_GENERATION_MODES, LIMITS, FIELD_LIMITS } from './index.js';
import { fail } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/codes.js';

/** 四类版块的固定顺序 */
export const REPORT_SECTION_ORDER = Object.freeze([
  'headline',
  'scene',
  'relation',
  'unsaid',
]);

/** 每份小报固定的 unsaid 条数，与居民数一致 */
export const REPORT_UNSAY_COUNT = LIMITS.AGENTS_PER_TOWN;

/** 版块默认标题 */
export const REPORT_SECTION_TITLES = Object.freeze({
  headline: '头条',
  scene: '场景',
  relation: '关系',
  unsaid: '没说出口的话',
});

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, `${label}不能为空`);
  }
}

/**
 * 小报结构校验。
 * @param {object} report
 * @param {{ requireComplete?: boolean }} [options] requireComplete=false 时允许缺版块（降级兜底场景）
 */
export function validateReport(report, { requireComplete = true } = {}) {
  if (!report || typeof report !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, '小报为空');
  }

  assertText(report.town_id, '小报的 town_id');
  if (!Number.isInteger(report.day) || report.day < 1 || report.day > LIMITS.DAYS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `小报的 day 必须在 1–${LIMITS.DAYS_PER_TOWN} 之间`);
  }
  assertText(report.headline, '小报头条');
  if (!REPORT_GENERATION_MODES.includes(report.generation_mode)) {
    fail(ERROR_CODES.E_VALIDATION, '小报生成模式不合法');
  }
  if (report.generated_at !== undefined && !Number.isInteger(report.generated_at)) {
    fail(ERROR_CODES.E_VALIDATION, '小报的 generated_at 必须是整数时间戳');
  }

  if (!Array.isArray(report.sections)) {
    fail(ERROR_CODES.E_VALIDATION, '小报必须包含 sections');
  }
  const kinds = new Set();
  const orders = new Set();
  for (const section of report.sections) {
    if (!section || typeof section !== 'object') {
      fail(ERROR_CODES.E_VALIDATION, '小报版块字段不完整');
    }
    if (!SECTION_KINDS.includes(section.kind)) {
      fail(ERROR_CODES.E_VALIDATION, `未知的小报版块类型：${section.kind}`);
    }
    if (kinds.has(section.kind)) {
      fail(ERROR_CODES.E_VALIDATION, `小报版块重复：${section.kind}`);
    }
    kinds.add(section.kind);
    assertText(section.title, '小报版块标题');
    assertText(section.body, '小报版块正文');
    if (!Number.isInteger(section.order)) {
      fail(ERROR_CODES.E_VALIDATION, '小报版块的 order 必须是整数');
    }
    if (orders.has(section.order)) {
      fail(ERROR_CODES.E_VALIDATION, `小报版块顺序重复：${section.order}`);
    }
    orders.add(section.order);
  }
  if (requireComplete && kinds.size !== SECTION_KINDS.length) {
    fail(ERROR_CODES.E_VALIDATION, `小报必须包含 ${SECTION_KINDS.length} 类版块`);
  }

  if (!Array.isArray(report.unsays)) {
    fail(ERROR_CODES.E_VALIDATION, '小报必须包含 unsays');
  }
  if (requireComplete && report.unsays.length !== REPORT_UNSAY_COUNT) {
    fail(ERROR_CODES.E_VALIDATION, `小报必须包含 ${REPORT_UNSAY_COUNT} 条没说出口的话`);
  }
  const agentIds = new Set();
  for (const unsay of report.unsays) {
    if (!unsay || typeof unsay !== 'object') {
      fail(ERROR_CODES.E_VALIDATION, 'unsay 字段不完整');
    }
    assertText(unsay.agent_id, 'unsay 的 agent_id');
    assertText(unsay.text, 'unsay 的正文');
    if (unsay.text.length > FIELD_LIMITS.MEMORY_IMPRESSION_MAX) {
      fail(ERROR_CODES.E_VALIDATION, `unsay 不能超过 ${FIELD_LIMITS.MEMORY_IMPRESSION_MAX} 个字符`);
    }
    if (agentIds.has(unsay.agent_id)) {
      fail(ERROR_CODES.E_VALIDATION, `unsay 重复对应同一个居民：${unsay.agent_id}`);
    }
    agentIds.add(unsay.agent_id);
  }

  return report;
}
