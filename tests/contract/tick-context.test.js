import { describe, it, expect } from 'vitest';
import { validateTickContext, estimateTokens, payloadBytes } from '../../shared/contracts/tick-context.js';
import { assembleContext } from '../../web/domain/memory/assemble.js';

function makeAgent(index, day) {
  return {
    id: `a${index}`,
    name: `居民${index}`,
    age: 30,
    occupation: '测试职业',
    persona: '测试人设',
    secret: '测试秘密',
    conflict_goal: '测试目标',
    speech_style: '测试口癖',
    current_location: null,
    plan: [],
    memories: {
      impressions: [],
      summaries: day > 1 ? [{ day: day - 1, content: '昨天的事' }] : [],
      today_events: [],
    },
  };
}

function makeContext({ day = 2 } = {}) {
  return {
    town: {
      id: 'town1',
      name: '测试镇',
      pace_mode: 'quick',
      day_index: day,
      template_id: 'seaside',
    },
    day_state: { weather: '晴', user_event: null },
    agents: [0, 1, 2, 3, 4].map((index) => makeAgent(index, day)),
    relations: [],
    limits: {
      max_dialogue_rounds: 6,
      max_context_tokens: 6000,
      budget_remaining_yuan: 5,
    },
  };
}

describe('Tick 上下文契约（tick-context）', () => {
  it('合法上下文通过 K1–K6 校验', () => {
    const { context, warnings } = validateTickContext(makeContext(), { dayIndex: 2 });
    expect(context.agents).toHaveLength(5);
    expect(warnings).toEqual([]);
  });

  it('K1：agents 不是 5 人时返回 E_VALIDATION', () => {
    const context = makeContext();
    context.agents.pop();
    expect(() => validateTickContext(context)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('K2：day_index 与 town.day_index 不一致时返回 E_TOWN_STATE', () => {
    expect(() => validateTickContext(makeContext({ day: 2 }), { dayIndex: 3 })).toThrowError(
      expect.objectContaining({ code: 'E_TOWN_STATE' })
    );
  });

  it('K3：第 2 天起每人必须有总结层，第 1 天可为空', () => {
    const dayTwo = makeContext({ day: 2 });
    dayTwo.agents[0].memories.summaries = [];
    expect(() => validateTickContext(dayTwo)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );

    expect(() => validateTickContext(makeContext({ day: 1 }))).not.toThrow();
  });

  it('K4：关系两端必须都在 agents 中', () => {
    const context = makeContext();
    context.relations.push({
      from_agent_id: 'a0',
      to_agent_id: 'unknown',
      affinity: 10,
      label: 'familiar',
    });
    expect(() => validateTickContext(context)).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' })
    );
  });

  it('K5：客户端上限高于服务端时取较小值并返回 W_LIMIT_CLAMPED', () => {
    const context = makeContext();
    context.limits.max_context_tokens = 9000;
    const { context: clamped, warnings } = validateTickContext(context);
    expect(clamped.limits.max_context_tokens).toBe(6000);
    expect(warnings.map((warning) => warning.code)).toContain('W_LIMIT_CLAMPED');
  });

  it('K6：整体超过 256KB 时返回 E_PAYLOAD_TOO_LARGE', () => {
    const context = makeContext();
    context.agents[0].persona = '长'.repeat(300000);
    expect(payloadBytes(context)).toBeGreaterThan(256 * 1024);
    expect(() => validateTickContext(context)).toThrowError(
      expect.objectContaining({ code: 'E_PAYLOAD_TOO_LARGE' })
    );
  });
});

describe('上下文组装与截断（tick-context）', () => {
  function agentsFixture() {
    return [0, 1, 2, 3, 4].map((index) => ({
      ...makeAgent(index, 3),
      plan_json: JSON.stringify([{ hour: 7, location: '码头', intent: '透气' }]),
    }));
  }

  function memoriesFixture(agentId, day) {
    const summaryDays = [...new Set([1, 2, day - 1, day])].filter(
      (value) => value >= 1 && value <= day
    );
    return [
      ...summaryDays.map((value) => ({
        agent_id: agentId,
        tier: 'summary',
        created_day: value,
        content: `第 ${value} 天的总结`,
      })),
      { agent_id: agentId, tier: 'impression', target_agent_id: 'a4', content: '对苗苗的印象' },
      { agent_id: agentId, tier: 'event', created_day: day, content: '今天去了码头' },
    ];
  }

  function memoriesFor(agents, day) {
    const memoriesByAgent = {};
    for (const agent of agents) memoriesByAgent[agent.id] = memoriesFixture(agent.id, day);
    return memoriesByAgent;
  }

  it('按 §7.3 结构输出，包含三层记忆与关系', () => {
    const agents = agentsFixture();
    const memoriesByAgent = memoriesFor(agents, 3);

    const context = assembleContext({
      town: {
        id: 'town1',
        name: '测试镇',
        pace_mode: 'quick',
        day_index: 3,
        template_id: 'seaside',
      },
      day: 3,
      agents,
      relations: [
        { from_agent_id: 'a0', to_agent_id: 'a1', affinity: 12, label: 'familiar' },
      ],
      dayState: { weather: '阴' },
      memoriesByAgent,
    });

    expect(context.town.day_index).toBe(3);
    expect(context.day_state.weather).toBe('阴');
    expect(context.agents[0].plan).toHaveLength(1);
    expect(context.agents[0].memories.summaries).toHaveLength(3);
    expect(context.agents[0].memories.impressions).toHaveLength(1);
    expect(context.agents[0].memories.today_events).toHaveLength(1);
    expect(context.relations).toHaveLength(1);
    expect(validateTickContext(context).warnings).toEqual([]);
  });

  it('超限时先丢 3 天前的总结层', () => {
    const agents = agentsFixture();
    const memoriesByAgent = memoriesFor(agents, 5);

    const full = assembleContext({
      town: {
        id: 'town1',
        name: '测试镇',
        pace_mode: 'quick',
        day_index: 5,
        template_id: 'seaside',
      },
      day: 5,
      agents,
      memoriesByAgent,
    });
    const trimmed = assembleContext({
      town: {
        id: 'town1',
        name: '测试镇',
        pace_mode: 'quick',
        day_index: 5,
        template_id: 'seaside',
      },
      day: 5,
      agents,
      memoriesByAgent,
      limits: { max_context_tokens: estimateTokens(full) - 1 },
    });

    expect(trimmed.agents[0].memories.summaries.map((summary) => summary.day)).toEqual([4, 5]);
    expect(trimmed.agents[0].memories.impressions).toHaveLength(1);
  });

  it('仍超限时再丢非在场者的印象层', () => {
    const agents = agentsFixture();
    const memoriesByAgent = memoriesFor(agents, 3);

    const context = assembleContext({
      town: {
        id: 'town1',
        name: '测试镇',
        pace_mode: 'quick',
        day_index: 3,
        template_id: 'seaside',
      },
      day: 3,
      agents,
      memoriesByAgent,
      limits: { max_context_tokens: 10 },
      presentAgentIds: ['a0'],
    });

    expect(context.agents.every((agent) => agent.memories.impressions.length === 0)).toBe(true);
  });
});
