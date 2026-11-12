import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import { runDay } from '../../web/domain/simulation/day.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';

async function setupTown() {
  const town = await dao.createTown(
    { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
    fiveAgents()
  );
  const agents = await dao.listAgents(town.id);
  return { town, agents };
}

beforeEach(async () => {
  await resetDB();
});

describe('对话落库与事件层记忆（dialogue-persist）', () => {
  it('每段对话落库，日终压缩后当日事件层归零、总结层可读', async () => {
    const { town, agents } = await setupTown();
    const outcome = await runDay({ town, agents, day: 1, model: createStubModel() });

    const dialogues = await dao.listDialogues(town.id, 1);
    expect(dialogues.length).toBeGreaterThan(0);
    expect(dialogues).toHaveLength(outcome.dialogues.length);

    for (const dialogue of dialogues) {
      expect(dialogue.participant_ids).toHaveLength(2);
      expect(dialogue.transcript.length).toBeGreaterThan(0);
      expect(dialogue.transcript.length).toBeLessThanOrEqual(6);
      for (const round of dialogue.transcript) {
        expect(round.speaker).toBeTruthy();
        expect(round.content).toBeTruthy();
      }
    }

    for (const agent of agents) {
      const summaries = await dao.listMemories(agent.id, 'summary');
      const daySummary = summaries.find((memory) => memory.created_day === 1);
      expect(daySummary).toBeTruthy();
      expect(daySummary.content.length).toBeLessThanOrEqual(80);

      const events = await dao.listMemories(agent.id, 'event');
      expect(events.filter((memory) => memory.created_day === 1)).toHaveLength(0);
    }
  });

  it('对话同时更新双方有向关系，单日变化不超过 ±8', async () => {
    const { town, agents } = await setupTown();
    await runDay({ town, agents, day: 1, model: createStubModel() });

    const [first, second] = agents;
    const forward = await dao.getRelation(first.id, second.id);
    const backward = await dao.getRelation(second.id, first.id);

    expect(forward).toBeTruthy();
    expect(backward).toBeTruthy();
    expect(forward.affinity).toBe(8);
    expect(backward.affinity).toBe(8);
    expect(forward.label).toBe('stranger');
    expect(forward.updated_day).toBe(1);
  });

  it('没有对话的居民不会凭空产生关系', async () => {
    const { town, agents } = await setupTown();
    await runDay({ town, agents, day: 1, model: createStubModel() });

    const relations = await dao.listRelations(town.id);
    const involved = new Set(relations.flatMap((relation) => [relation.from_agent_id, relation.to_agent_id]));
    expect(involved.has(agents[0].id)).toBe(true);
    expect(involved.has(agents[1].id)).toBe(true);
    expect(involved.has(agents[2].id)).toBe(false);
  });
});
