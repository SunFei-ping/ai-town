import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import { runDay } from '../../web/domain/simulation/day.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import { WARNING_CODES } from '../../shared/errors/codes.js';

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

describe('单日编排（桩模型，5 人）', () => {
  it('5 个居民走完计划 → 相遇对话 → 独白，全程不触网', async () => {
    const { town, agents } = await setupTown();
    const model = createStubModel();
    const stages = [];

    const outcome = await runDay({
      town,
      agents,
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
    expect(outcome.plans).toHaveLength(5);
    expect(outcome.plans.every((plan) => plan.plan.length === 4)).toBe(true);
    expect(outcome.unsays).toHaveLength(5);
    expect(outcome.dialogues.length).toBeGreaterThan(0);
    expect(outcome.state).toBe('done');
    expect(outcome.dayStatus).toBe('done');
    expect(model.calls).toBe(5 + outcome.dialogues.length + 5);
  });

  it('落库正确：天数推进、当日状态、计划、独白与对话', async () => {
    const { town, agents } = await setupTown();
    await runDay({ town, agents, day: 1, model: createStubModel() });

    const updated = await dao.getTown(town.id);
    expect(updated.day_index).toBe(1);

    const dayState = await dao.getDayState(town.id, 1);
    expect(dayState.status).toBe('done');
    expect(dayState.weather).toBeTruthy();

    const savedAgents = await dao.listAgents(town.id);
    for (const agent of savedAgents) {
      expect(agent.plan_json).toContain('码头');
      const memories = await dao.listMemories(agent.id, 'event');
      expect(memories.some((memory) => memory.expire_day === 1)).toBe(true);
    }

    expect((await dao.listDialogues(town.id, 1)).length).toBeGreaterThan(0);
  });

  it('计划阶段全部失败时使用模板计划，记 W_STAGE_DEGRADED 但不阻塞当天', async () => {
    const { town, agents } = await setupTown();
    const warnings = [];
    const outcome = await runDay({
      town,
      agents,
      day: 1,
      model: createStubModel({ failOn: 'plan' }),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(outcome.state).toBe('done');
    expect(outcome.dayStatus).toBe('done');
    expect(outcome.plans).toHaveLength(5);
    expect(outcome.plans.every((plan) => plan.degraded)).toBe(true);
    expect(outcome.unsays).toHaveLength(5);
    expect(warnings.filter((item) => item.code === WARNING_CODES.W_STAGE_DEGRADED)).toHaveLength(5);

    const dayState = await dao.getDayState(town.id, 1);
    expect(dayState.status).toBe('done');
  });

  it('独白阶段失败时降级收尾为 partial', async () => {
    const { town, agents } = await setupTown();
    const outcome = await runDay({
      town,
      agents,
      day: 1,
      model: createStubModel({ failOn: 'unsay' }),
    });

    expect(outcome.state).toBe('done');
    expect(outcome.dayStatus).toBe('partial');
    expect(outcome.unsays).toHaveLength(0);
    expect(outcome.stages).toContain('degraded');

    const dayState = await dao.getDayState(town.id, 1);
    expect(dayState.status).toBe('partial');
  });

  it('天数不连续时拒绝推进', async () => {
    const { town, agents } = await setupTown();
    await expect(
      runDay({ town, agents, day: 2, model: createStubModel() })
    ).rejects.toMatchObject({ code: 'E_TOWN_STATE' });
  });

  it('小镇非 running 状态时拒绝推进', async () => {
    const { town, agents } = await setupTown();
    await expect(
      runDay({ town: { ...town, status: 'completed' }, agents, day: 1, model: createStubModel() })
    ).rejects.toMatchObject({ code: 'E_TOWN_STATE' });
  });

  it('居民数量不是 5 人时拒绝推进（C1）', async () => {
    const { town, agents } = await setupTown();
    await expect(
      runDay({ town, agents: agents.slice(0, 4), day: 1, model: createStubModel() })
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});
