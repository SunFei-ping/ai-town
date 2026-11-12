import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateReport, REPORT_SECTION_ORDER } from '../../shared/contracts/report.js';
import { buildReport } from '../../web/domain/report/builder.js';
import { SECTION_KINDS, REPORT_GENERATION_MODES } from '../../shared/contracts/index.js';

const SAMPLE_DIR = new URL('../../data/sample-town/', import.meta.url);

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, SAMPLE_DIR), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  const town = { id: 'town1', name: '测试镇' };
  const agents = ['陈望', '林小满', '周秀兰', '阿彪', '苗苗'].map((name, index) => ({
    id: `a${index}`,
    name,
  }));
  const report = buildReport({
    town,
    day: 1,
    agents,
    unsays: agents.map((agent) => ({
      agent_id: agent.id,
      agent_name: agent.name,
      text: `${agent.name}今天有一句话留在了心里，没有对任何人说起。`,
    })),
    dialogues: [
      {
        town_id: town.id,
        day: 1,
        hour: 14,
        location: '码头',
        participant_ids: [agents[0].id, agents[1].id],
        transcript: [
          { speaker: agents[0].name, content: '今天风大。' },
          { speaker: agents[1].name, content: '嗯。' },
        ],
        rounds: 2,
      },
    ],
    relationUpdates: [
      {
        town_id: town.id,
        from_agent_id: agents[0].id,
        to_agent_id: agents[1].id,
        affinity: 3,
        label: 'familiar',
        updated_day: 1,
      },
    ],
  });
  return { report, agents };
}

const { report: validReport } = fixture();

describe('小报契约（report）', () => {
  it('合法小报通过校验：四类 section 与 5 条 unsaid', () => {
    expect(validateReport(validReport)).toBe(validReport);
    expect(validReport.sections.map((section) => section.kind).sort()).toEqual(
      [...SECTION_KINDS].sort()
    );
    expect(validReport.sections.map((section) => section.order)).toEqual([1, 2, 3, 4]);
    expect(validReport.unsays).toHaveLength(5);
    expect(REPORT_GENERATION_MODES).toContain(validReport.generation_mode);
    expect(REPORT_SECTION_ORDER).toEqual(['headline', 'scene', 'relation', 'unsaid']);
  });

  it('四类 section 缺任一或 unsaid 数量不对时校验失败', () => {
    const missingScene = clone(validReport);
    missingScene.sections = missingScene.sections.filter((section) => section.kind !== 'scene');
    expect(() => validateReport(missingScene)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    const fourUnsays = clone(validReport);
    fourUnsays.unsays.pop();
    expect(() => validateReport(fourUnsays)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('生成模式非法或版块正文为空时校验失败', () => {
    const badMode = clone(validReport);
    badMode.generation_mode = 'manual';
    expect(() => validateReport(badMode)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    const emptyBody = clone(validReport);
    emptyBody.sections[1].body = '   ';
    expect(() => validateReport(emptyBody)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('示例小镇 7 天小报全部合规，四类版块与 5 条 unsaid 齐全', () => {
    const { town, agents } = readJson('town.json');
    const names = new Set(agents.map((agent) => agent.name));

    for (let day = 1; day <= town.day_index; day += 1) {
      const report = readJson(`reports/day-${day}.json`);
      validateReport(report);

      expect(report.town_id).toBe(town.id);
      expect(report.day).toBe(day);
      expect(report.sections.map((section) => section.kind).sort()).toEqual(
        [...SECTION_KINDS].sort()
      );
      expect(report.unsays).toHaveLength(5);
      expect(new Set(report.unsays.map((unsay) => unsay.agent_id)).size).toBe(5);

      // §12.3 规则项：每份小报至少 1 条关系变化
      const relation = report.sections.find((section) => section.kind === 'relation');
      expect(relation.body).toMatch(/→/);

      // §12.3 规则项：5 条 unsaid 各不相同，≥15 字且含专有名词
      const texts = report.unsays.map((unsay) => unsay.text);
      expect(new Set(texts).size).toBe(5);
      for (const text of texts) {
        expect(text.length).toBeGreaterThanOrEqual(15);
        expect([...names].some((name) => text.includes(name))).toBe(true);
      }
    }
  });

  it('示例小镇覆盖三态中的至少两种生成模式', () => {
    const modes = new Set();
    for (let day = 1; day <= 7; day += 1) {
      modes.add(readJson(`reports/day-${day}.json`).generation_mode);
    }
    expect(modes.has('normal')).toBe(true);
    expect(modes.size).toBeGreaterThanOrEqual(2);
  });
});
