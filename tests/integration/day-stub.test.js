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
  return { town, agent: agents[0] };
}

beforeEach(async () => {
  await resetDB();
});

describe('单日编排（桩模型）', () => {
  it('一个居民走完计划 → 行动 → 独白，全程不触网', async () => {
    const { town, agent } = await setupTown();
    const model = createStubModel();
    const stages = [];

    const outcome = await runDay({
      town,
      agent,
      day: 1,
      model,
      onStage: (state) => stages.push(state),
    });

    expect(stages).toEqual([
      'validating',
      'planning',
      'simulating',
      'reflecting',
      'reporting',
      'done',
    ]);
    expect(outcome.plan).toHaveLength(4);
    expect(outcome.unsay).toContain(agent.name);
    expect(outcome.state).toBe('done');
    expect(outcome.dayStatus).toBe('done');
    expect(model.calls).toBe(2);
  });

  it('落库正确：天数推进、当日状态、独白记忆、当日计划', async () => {
    const { town, agent } = await setupTown();
    await runDay({ town, agent, day: 1, model: createStubModel() });

    const updated = await dao.getTown(town.id);
    expect(updated.day_index).toBe(1);

    const dayState = await dao.getDayState(town.id, 1);
    expect(dayState.status).toBe('done');
    expect(dayState.weather).toBeTruthy();

    const memories = await dao.listMemories(agent.id, 'event');
    expect(memories).toHaveLength(1);
    expect(memories[0].expire_day).toBe(1);

    const agents = await dao.listAgents(town.id);
    expect(agents[0].plan_json).toContain('码头');
  });

  it('计划阶段失败时降级，仍能收尾为 partial', async () => {
    const { town, agent } = await setupTown();
    const outcome = await runDay({
      town,
      agent,
      day: 1,
      model: createStubModel({ failOn: 'plan' }),
    });

    expect(outcome.state).toBe('done');
    expect(outcome.dayStatus).toBe('partial');
    expect(outcome.unsay).toBeNull();

    const dayState = await dao.getDayState(town.id, 1);
    expect(dayState.status).toBe('partial');
  });

  it('天数不连续时拒绝推进', async () => {
    const { town, agent } = await setupTown();
    await expect(runDay({ town, agent, day: 2, model: createStubModel() })).rejects.toMatchObject({
      code: 'E_TOWN_STATE',
    });
  });

  it('小镇非 running 状态时拒绝推进', async () => {
    const { town, agent } = await setupTown();
    await expect(
      runDay({ town: { ...town, status: 'completed' }, agent, day: 1, model: createStubModel() })
    ).rejects.toMatchObject({ code: 'E_TOWN_STATE' });
  });
});
