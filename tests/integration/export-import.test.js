import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import { runDay } from '../../web/domain/simulation/day.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import {
  exportTownJson,
  exportTownMarkdown,
  importTownJson,
} from '../../web/infra/storage/export.js';
import { SCHEMA_VERSION } from '../../shared/contracts/index.js';

async function setupTownWithDayOne() {
  const town = await dao.createTown(
    { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
    fiveAgents()
  );
  const agents = await dao.listAgents(town.id);
  await dao.addEvent({
    town_id: town.id,
    day: 1,
    type: 'loss',
    payload: '有人在码头丢了一个钱包',
    source: 'user',
    created_at: Date.now(),
  });
  await runDay({ town, agents, day: 1, model: createStubModel() });
  return { town, agents };
}

beforeEach(async () => {
  await resetDB();
});

describe('导出与回导（export-import）', () => {
  it('town.json 含 schema_version 与全部表数据', async () => {
    const { town } = await setupTownWithDayOne();
    const file = await exportTownJson(town.id);
    const payload = JSON.parse(file.content);

    expect(file.filename).toMatch(/\.json$/);
    expect(payload.schema_version).toBe(SCHEMA_VERSION);
    expect(payload.town.id).toBe(town.id);
    for (const name of [
      'agent',
      'day_state',
      'memory',
      'relation',
      'event',
      'dialogue',
      'daily_report',
      'report_section',
      'unsay',
      'usage',
    ]) {
      expect(Array.isArray(payload.tables[name])).toBe(true);
    }

    expect(payload.tables.agent).toHaveLength(5);
    expect(payload.tables.daily_report).toHaveLength(1);
    expect(payload.tables.unsay).toHaveLength(5);
    expect(payload.tables.event).toHaveLength(1);
    expect(payload.tables.memory.length).toBeGreaterThan(0);
  });

  it('回导后可恢复数据并从当前天继续推进', async () => {
    const { town } = await setupTownWithDayOne();
    const file = await exportTownJson(town.id);

    // 模拟换设备：清空本地库后回导
    await resetDB();
    await expect(dao.getTown(town.id)).rejects.toMatchObject({ code: 'E_TOWN_STATE' });

    const imported = await importTownJson(file.content);
    expect(imported.id).toBe(town.id);
    expect(imported.day_index).toBe(1);

    const restored = await dao.getTown(town.id);
    const agents = await dao.listAgents(town.id);
    expect(agents).toHaveLength(5);
    expect(await dao.getReport(town.id, 1)).not.toBeNull();
    expect(await dao.listEvents(town.id, 1)).toHaveLength(1);

    const outcome = await runDay({
      town: restored,
      agents,
      day: 2,
      model: createStubModel(),
    });
    expect(outcome.town.day_index).toBe(2);
    expect(await dao.getReport(town.id, 2)).not.toBeNull();
  });

  it('同 id 回导会整体替换已有小镇，不产生重复数据', async () => {
    const { town } = await setupTownWithDayOne();
    const file = await exportTownJson(town.id);

    await importTownJson(file.content);
    await importTownJson(file.content);

    expect(await dao.listAgents(town.id)).toHaveLength(5);
    expect(await dao.listReports(town.id)).toHaveLength(1);
  });

  it('town.md 可读且不暴露数据结构', async () => {
    const { town } = await setupTownWithDayOne();
    const file = await exportTownMarkdown(town.id);

    expect(file.filename).toMatch(/\.md$/);
    expect(file.content).toContain(`# ${town.name}`);
    expect(file.content).toContain('陈望');
    expect(file.content).toContain('没说出口的话');
    expect(file.content).toContain('本故事由 AI 虚构生成');
    expect(file.content).not.toContain('{"');
    expect(file.content).not.toContain('town_id');
  });

  it('schema_version 不兼容时拒绝回导', async () => {
    const { town } = await setupTownWithDayOne();
    const file = await exportTownJson(town.id);
    const payload = JSON.parse(file.content);
    payload.schema_version = '2.0.0';

    await expect(importTownJson(payload)).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('非法 JSON 给出 E_VALIDATION', async () => {
    await expect(importTownJson('{ not json')).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});
