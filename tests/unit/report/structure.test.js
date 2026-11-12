import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../../support/db.js';
import * as dao from '../../../web/infra/storage/dao.js';
import {
  createSection,
  createReportRecord,
  REPORT_SECTION_ORDER,
} from '../../../web/domain/report/structure.js';
import { buildReport, buildRelationBody } from '../../../web/domain/report/builder.js';
import { validateReport } from '../../../shared/contracts/report.js';

function unsaysFor(agents) {
  return agents.map((agent) => ({
    agent_id: agent.id,
    agent_name: agent.name,
    text: `${agent.name}今天有一句话留在了心里，没有对任何人说起。`,
  }));
}

function dialogueFor(town, agents) {
  return {
    town_id: town.id,
    day: 1,
    hour: 14,
    location: '码头',
    participant_ids: [agents[0].id, agents[1].id],
    transcript: [
      { speaker: agents[0].name, content: '今天风大。' },
      { speaker: agents[1].name, content: '嗯，风比昨天大。' },
    ],
    rounds: 2,
  };
}

function relationUpdatesFor(town, agents) {
  return [
    {
      town_id: town.id,
      from_agent_id: agents[0].id,
      to_agent_id: agents[1].id,
      affinity: 3,
      label: 'familiar',
      updated_day: 1,
    },
    {
      town_id: town.id,
      from_agent_id: agents[1].id,
      to_agent_id: agents[0].id,
      affinity: 3,
      label: 'familiar',
      updated_day: 1,
    },
  ];
}

function fixture() {
  const town = { id: 'town1', name: '测试镇' };
  const agents = [0, 1, 2, 3, 4].map((index) => ({
    id: `a${index}`,
    name: ['陈望', '林小满', '周秀兰', '阿彪', '苗苗'][index],
  }));
  return { town, agents };
}

function makeReport(overrides = {}) {
  const { town, agents } = fixture();
  return buildReport({
    town,
    day: 1,
    agents,
    unsays: unsaysFor(agents),
    dialogues: [dialogueFor(town, agents)],
    previousRelations: [],
    relationUpdates: relationUpdatesFor(town, agents),
    ...overrides,
  });
}

describe('小报结构（report-structure）', () => {
  it('createSection 固定四类版块的标题与顺序', () => {
    const section = createSection('scene', '14 点，码头。');
    expect(section.kind).toBe('scene');
    expect(section.title).toBe('场景');
    expect(section.order).toBe(REPORT_SECTION_ORDER.indexOf('scene') + 1);

    expect(() => createSection('unknown', '正文')).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
    expect(() => createSection('scene', '  ')).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('一份小报包含四类版块与 5 条 unsaid，并通过校验', () => {
    const report = makeReport();
    expect(report.sections.map((section) => section.kind)).toEqual([
      'headline',
      'scene',
      'relation',
      'unsaid',
    ]);
    expect(report.unsays).toHaveLength(5);
    expect(validateReport(report)).toBe(report);
  });

  it('关系版块至少写出 1 条当天变化', () => {
    const report = makeReport();
    const relation = report.sections.find((section) => section.kind === 'relation');
    expect(relation.body).toContain('→');
    expect(relation.body).toContain('0 → 3');

    const noChange = buildRelationBody({
      names: new Map([['a0', '陈望']]),
      previousRelations: [],
      relationUpdates: [],
    });
    expect(noChange).toContain('没有变化');
  });

  it('版块缺失、重复或类型非法时返回 E_VALIDATION', () => {
    const missing = makeReport();
    missing.sections = missing.sections.slice(0, 3);
    expect(() => validateReport(missing)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    const duplicate = makeReport();
    duplicate.sections[1] = { ...duplicate.sections[0], order: 2 };
    expect(() => validateReport(duplicate)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    const badKind = makeReport();
    badKind.sections[0].kind = 'weather';
    expect(() => validateReport(badKind)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('unsaid 不是 5 条或对应重复时返回 E_VALIDATION', () => {
    const four = makeReport();
    four.unsays = four.unsays.slice(0, 4);
    expect(() => validateReport(four)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    const duplicate = makeReport();
    duplicate.unsays[1].agent_id = duplicate.unsays[0].agent_id;
    expect(() => validateReport(duplicate)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('day 越界或生成模式非法时返回 E_VALIDATION', () => {
    expect(() =>
      createReportRecord({
        townId: 'town1',
        day: 8,
        headline: '超出一周',
        sections: makeReport().sections,
        unsays: makeReport().unsays,
      })
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));

    expect(() => makeReport({ generationMode: 'manual' })).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });
});

describe('小报落库（report-structure）', () => {
  beforeEach(async () => {
    await resetDB();
  });

  async function setupTown() {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const agents = await dao.listAgents(town.id);
    return { town, agents };
  }

  it('落库后可按天取回四类版块与 5 条 unsaid', async () => {
    const { town, agents } = await setupTown();
    const report = buildReport({
      town,
      day: 1,
      agents,
      unsays: unsaysFor(agents),
      dialogues: [dialogueFor(town, agents)],
      previousRelations: [],
      relationUpdates: relationUpdatesFor(town, agents),
    });

    await dao.saveReport(report);
    const stored = await dao.getReport(town.id, 1);

    expect(stored).toBeTruthy();
    expect(stored.sections).toHaveLength(4);
    expect(stored.sections.map((section) => section.kind)).toEqual([
      'headline',
      'scene',
      'relation',
      'unsaid',
    ]);
    expect(stored.unsays).toHaveLength(5);
    expect(await dao.listReports(town.id)).toHaveLength(1);
  });

  it('(town_id, day) 唯一：重复生成同一天小报时报错', async () => {
    const { town, agents } = await setupTown();
    const report = buildReport({
      town,
      day: 1,
      agents,
      unsays: unsaysFor(agents),
      dialogues: [dialogueFor(town, agents)],
      previousRelations: [],
      relationUpdates: relationUpdatesFor(town, agents),
    });

    await dao.saveReport(report);
    await expect(dao.saveReport(report)).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});
