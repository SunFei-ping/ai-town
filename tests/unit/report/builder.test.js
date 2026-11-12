import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../../support/db.js';
import * as dao from '../../../web/infra/storage/dao.js';
import { buildReport } from '../../../web/domain/report/builder.js';

const MODES = ['normal', 'backfill', 'degraded'];

function reportFor({ town, agents, day, mode }) {
  return buildReport({
    town,
    day,
    agents,
    generationMode: mode,
    unsays: agents.map((agent) => ({
      agent_id: agent.id,
      agent_name: agent.name,
      text: `${agent.name}今天有一句话没有说出口，一直留到了晚上。`,
    })),
    dialogues: [
      {
        town_id: town.id,
        day,
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
        updated_day: day,
      },
    ],
  });
}

describe('小报生成模式三态（generation-mode）', () => {
  beforeEach(async () => {
    await resetDB();
  });

  it('normal / backfill / degraded 三态可写入、可查询', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const agents = await dao.listAgents(town.id);

    for (let index = 0; index < MODES.length; index += 1) {
      const day = index + 1;
      await dao.saveReport(reportFor({ town, agents, day, mode: MODES[index] }));
      const stored = await dao.getReport(town.id, day);
      expect(stored.generation_mode).toBe(MODES[index]);
    }

    expect((await dao.listReports(town.id)).map((report) => report.generation_mode)).toEqual(MODES);
  });

  it('未知生成模式返回 E_VALIDATION', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const agents = await dao.listAgents(town.id);
    expect(() => reportFor({ town, agents, day: 1, mode: 'manual' })).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });
});
