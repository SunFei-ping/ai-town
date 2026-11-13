/**
 * SPCD §12.3 剧情质量评测 · 规则项（可自动）。
 * 仅用于测试与验收，不参与运行时链路。
 */

/** 零信息开场阈值：超过该次数即判定为失败样本（初始值） */
export const ZERO_INFO_OPENING_THRESHOLD = 2;

/** 小报 unsaid 的最小长度（字） */
export const MIN_UNSAID_LENGTH = 15;

const ZERO_INFO_PHRASES = [
  '好久不见',
  '最近怎么样',
  '最近好吗',
  '今天天气真好',
  '天气不错',
  '吃饭了吗',
  '吃了吗',
  '早上好',
  '中午好',
  '下午好',
  '晚上好',
  '早安',
  '晚安',
  '你好吗',
  '你好',
  '您好',
  '哈喽',
  '嗨',
  '在不在',
  '在吗',
];

const PUNCTUATION = /[\s，。！？、,.!?~～…—\-"'“”‘’：:；;]/g;

/**
 * 判断一句开场白是否为零信息：去掉标点与寒暄用语后不剩任何具体内容。
 */
export function isZeroInfoOpening(text) {
  if (typeof text !== 'string') return false;

  let rest = text.replace(PUNCTUATION, '');
  if (rest === '') return true;

  for (const phrase of ZERO_INFO_PHRASES) {
    rest = rest.split(phrase).join('');
  }
  return rest === '';
}

/**
 * 规则一：对话中零信息开场不超过阈值。
 * @param {Array} dialogues 对话记录，结构同 DIALOGUE（取 transcript[0].content 作为开场）
 */
export function evaluateDialogueQuality(dialogues = [], { threshold = ZERO_INFO_OPENING_THRESHOLD } = {}) {
  const openings = dialogues
    .map((dialogue) => dialogue?.transcript?.[0]?.content)
    .filter((content) => typeof content === 'string');

  const zeroInfoOpenings = openings.filter((content) => isZeroInfoOpening(content)).length;

  return {
    openings: openings.length,
    zeroInfoOpenings,
    passed: zeroInfoOpenings <= threshold,
  };
}

/**
 * 规则二、三：每份小报至少 1 条关系变化；5 条 unsaid 各不相同且含具体细节。
 * @param {object} report 小报结构（shared/contracts/report.js）
 */
export function evaluateReportQuality(report, { minUnsaidLength = MIN_UNSAID_LENGTH } = {}) {
  const failures = [];

  const relation = report?.sections?.find((section) => section.kind === 'relation');
  if (!relation || !/-?\d+\s*→\s*-?\d+/.test(relation.body ?? '')) {
    failures.push('relation: 缺少至少 1 条关系变化');
  }

  const unsays = Array.isArray(report?.unsays) ? report.unsays : [];
  if (unsays.length !== 5) {
    failures.push(`unsaid: 数量应为 5，实际 ${unsays.length}`);
  }

  const texts = unsays.map((unsay) => (unsay?.text ?? '').trim());
  if (new Set(texts).size !== texts.length) {
    failures.push('unsaid: 5 条内容必须各不相同');
  }

  const names = unsays.map((unsay) => unsay?.agent_name).filter(Boolean);

  for (const [index, unsay] of unsays.entries()) {
    const text = texts[index];
    if (text.length < minUnsaidLength) {
      failures.push(`unsaid: 第 ${index + 1} 条少于 ${minUnsaidLength} 字`);
    }
    if (!names.some((name) => text.includes(name))) {
      failures.push(`unsaid: 第 ${index + 1} 条缺少专有名词`);
    }
  }

  return { passed: failures.length === 0, failures };
}
