/**
 * 小报结构生成，见 SPCD §6.2。
 * 一份小报固定四类版块：headline / scene / relation / unsaid，顺序固定。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import {
  REPORT_SECTION_ORDER,
  REPORT_SECTION_TITLES,
  validateReport,
} from '../../../shared/contracts/report.js';

export { REPORT_SECTION_ORDER, REPORT_SECTION_TITLES };

/** 生成一个版块；kind 决定固定标题与顺序 */
export function createSection(kind, body) {
  if (!REPORT_SECTION_ORDER.includes(kind)) {
    fail(ERROR_CODES.E_VALIDATION, `未知的小报版块类型：${kind}`);
  }
  if (typeof body !== 'string' || body.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, `小报版块 ${kind} 的正文不能为空`);
  }
  return {
    kind,
    title: REPORT_SECTION_TITLES[kind],
    body: body.trim(),
    order: REPORT_SECTION_ORDER.indexOf(kind) + 1,
  };
}

/**
 * 组装一份小报并做结构校验。
 * unsay 结构为 [{ agent_id, agent_name, text }]。
 */
export function createReportRecord({
  townId,
  day,
  headline,
  generationMode = 'normal',
  sections,
  unsays,
  generatedAt,
}) {
  const report = {
    town_id: townId,
    day,
    headline,
    generation_mode: generationMode,
    generated_at: generatedAt ?? Date.now(),
    sections,
    unsays,
  };
  return validateReport(report);
}
