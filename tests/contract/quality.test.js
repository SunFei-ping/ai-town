import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluateDialogueQuality,
  evaluateReportQuality,
  isZeroInfoOpening,
  MIN_UNSAID_LENGTH,
  ZERO_INFO_OPENING_THRESHOLD,
} from '../support/quality.js';

const SAMPLE_DIR = new URL('../../data/sample-town/', import.meta.url);

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, SAMPLE_DIR), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dialogue(opening) {
  return { transcript: [{ speaker: '陈望', content: opening }] };
}

describe('剧情质量规则（§12.3）', () => {
  it('零信息开场：纯问候与寒暄算零信息，含具体内容的不算', () => {
    expect(isZeroInfoOpening('你好')).toBe(true);
    expect(isZeroInfoOpening('你好，吃了吗？')).toBe(true);
    expect(isZeroInfoOpening('嗨～')).toBe(true);
    expect(isZeroInfoOpening('今天风大，别把杯子端出来。')).toBe(false);
    expect(isZeroInfoOpening('你好，今天码头风大。')).toBe(false);
  });

  it('规则一：同一局零信息开场不超过 2 次通过，超过阈值判定失败样本', () => {
    const two = evaluateDialogueQuality([
      dialogue('你好'),
      dialogue('吃了吗？'),
      dialogue('今天风大，别把杯子端出来。'),
    ]);
    expect(two.zeroInfoOpenings).toBe(2);
    expect(two.passed).toBe(true);

    const three = evaluateDialogueQuality([
      dialogue('你好'),
      dialogue('吃了吗？'),
      dialogue('早上好'),
    ]);
    expect(three.zeroInfoOpenings).toBe(3);
    expect(three.passed).toBe(false);
    expect(ZERO_INFO_OPENING_THRESHOLD).toBe(2);
  });

  it('规则二与规则三：示例小镇 7 天小报全部合规', () => {
    const { town } = readJson('town.json');

    for (let day = 1; day <= town.day_index; day += 1) {
      const result = evaluateReportQuality(readJson(`reports/day-${day}.json`));
      expect(result.failures).toEqual([]);
      expect(result.passed).toBe(true);
    }
  });

  it('规则二与规则三：违规小报被拦截', () => {
    const report = clone(readJson('reports/day-1.json'));

    const noRelation = clone(report);
    noRelation.sections.find((section) => section.kind === 'relation').body = '今天没有人走近。';
    expect(evaluateReportQuality(noRelation).failures).toContain('relation: 缺少至少 1 条关系变化');

    const duplicated = clone(report);
    duplicated.unsays[1].text = duplicated.unsays[0].text;
    expect(evaluateReportQuality(duplicated).failures).toContain('unsaid: 5 条内容必须各不相同');

    const tooShort = clone(report);
    tooShort.unsays[0].text = '陈望没说话。';
    expect(evaluateReportQuality(tooShort).failures).toContain(
      `unsaid: 第 1 条少于 ${MIN_UNSAID_LENGTH} 字`
    );

    const noNoun = clone(report);
    noNoun.unsays[0].text = '有人把想说的话咽了回去，直到天黑也没有开口。';
    expect(evaluateReportQuality(noNoun).failures).toContain('unsaid: 第 1 条缺少专有名词');

    const missing = clone(report);
    missing.unsays.pop();
    expect(evaluateReportQuality(missing).failures).toContain('unsaid: 数量应为 5，实际 4');
  });
});
