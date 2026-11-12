import { describe, it, expect } from 'vitest';
import { generatePlans, fallbackPlan } from '../../../web/domain/agent/plan.js';
import { WARNING_CODES } from '../../../shared/errors/codes.js';
import { fiveAgents } from '../../support/db.js';

const TOWN = { id: 'town_test', name: '测试镇', day_index: 0 };

function buildAgents() {
  return fiveAgents().map((agent, index) => ({
    ...agent,
    id: `agent_${index}`,
  }));
}

function createModel({ failFor = [], delayMs = 15 } = {}) {
  const calls = new Map();
  let active = 0;
  let peak = 0;

  async function complete({ stage, agent }) {
    if (stage !== 'plan') throw new Error(`unexpected stage ${stage}`);
    calls.set(agent.name, (calls.get(agent.name) ?? 0) + 1);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    active -= 1;
    if (failFor.includes(agent.name)) throw new Error('model failed');
    return { plan: [{ hour: 7, location: '码头', intent: '看看' }] };
  }

  return {
    complete,
    get peak() {
      return peak;
    },
    callsFor(name) {
      return calls.get(name) ?? 0;
    },
  };
}

describe('五人并行计划（plan-parallel）', () => {
  it('5 条计划并发发起，顺序与居民一致', async () => {
    const agents = buildAgents();
    const model = createModel();

    const plans = await generatePlans({ model, town: TOWN, agents, day: 1 });

    expect(model.peak).toBe(5);
    expect(plans).toHaveLength(5);
    expect(plans.map((item) => item.agent_id)).toEqual(agents.map((agent) => agent.id));
    expect(plans.every((item) => item.plan.length === 1 && !item.degraded)).toBe(true);
  });

  it('单条失败重试 1 次后使用模板计划，并记录 W_STAGE_DEGRADED', async () => {
    const agents = buildAgents();
    const failing = agents[2].name;
    const model = createModel({ failFor: [failing] });
    const warnings = [];

    const plans = await generatePlans({
      model,
      town: TOWN,
      agents,
      day: 1,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(plans).toHaveLength(5);
    expect(model.callsFor(failing)).toBe(2);
    const degraded = plans.find((item) => item.agent_id === agents[2].id);
    expect(degraded.degraded).toBe(true);
    expect(degraded.plan).toEqual(fallbackPlan(agents[2]));
    expect(warnings).toEqual([
      expect.objectContaining({ code: WARNING_CODES.W_STAGE_DEGRADED }),
    ]);
  });

  it('全部失败时仍必得 5 条模板计划', async () => {
    const agents = buildAgents();
    const model = createModel({ failFor: agents.map((agent) => agent.name) });

    const plans = await generatePlans({ model, town: TOWN, agents, day: 1 });

    expect(plans).toHaveLength(5);
    expect(plans.every((item) => item.degraded && item.plan.length === 4)).toBe(true);
  });
});
