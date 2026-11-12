import { describe, it, expect } from 'vitest';
import {
  locationAt,
  buildTimeline,
  resolveEncounters,
  collectEncounters,
  normalizeLocation,
  ensureDailyEncounter,
} from '../../../web/domain/simulation/encounter.js';

function makeAgents(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `agent_${index}`,
    name: `居民${index}`,
    occupation: '测试职业',
  }));
}

function plan(segments) {
  return segments.map(([hour, location]) => ({ hour, location, intent: '测试' }));
}

describe('位置推进与相遇（encounter）', () => {
  it('按小时取当前时间段的位置', () => {
    const p = plan([
      [7, '码头'],
      [10, '家'],
    ]);
    expect(locationAt(p, 6)).toBeNull();
    expect(locationAt(p, 7)?.location).toBe('码头');
    expect(locationAt(p, 9)?.location).toBe('码头');
    expect(locationAt(p, 10)?.location).toBe('家');
  });

  it('同地点 2 人产生一段相遇，先到者发起', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '码头'], [10, '码头']]) },
      { agent_id: 'agent_1', plan: plan([[10, '码头']]) },
    ];

    const { timeline, encounters, passedBy } = collectEncounters({ agents, plans });

    expect(timeline.map((item) => item.hour)).toEqual([7, 10]);
    expect(encounters).toHaveLength(1);
    expect(encounters[0]).toMatchObject({
      hour: 10,
      location: '码头',
      initiator_id: 'agent_0',
      participant_ids: ['agent_0', 'agent_1'],
    });
    expect(passedBy).toHaveLength(0);
  });

  it('位置不同不触发相遇', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '码头']]) },
      { agent_id: 'agent_1', plan: plan([[7, '学校']]) },
    ];
    expect(collectEncounters({ agents, plans }).encounters).toHaveLength(0);
  });

  it('同一地点的不同写法归一化到同一地点', () => {
    expect(normalizeLocation('五金店卷帘门前')).toBe('五金店');
    expect(normalizeLocation('五金店柜台后')).toBe('五金店');
    expect(normalizeLocation('镇口面馆')).toBe('面馆');
    expect(normalizeLocation('镇上国道边的面馆')).toBe('面馆');
    expect(normalizeLocation('镇口早点摊')).toBe('早餐摊');
    expect(normalizeLocation('巷口早餐摊')).toBe('早餐摊');
    expect(normalizeLocation('镇口菜摊')).toBe('菜市场');
    expect(normalizeLocation('学校操场边')).toBe('学校');
    expect(normalizeLocation('自家小院')).toBe('小院');
    expect(normalizeLocation('自家客厅')).toBe('客厅');
  });

  it('地点写法不同但归一化后相同，仍触发相遇', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '五金店卷帘门前']]) },
      { agent_id: 'agent_1', plan: plan([[8, '五金店柜台后']]) },
    ];

    const { encounters } = collectEncounters({ agents, plans });
    expect(encounters).toHaveLength(1);
    expect(encounters[0]).toMatchObject({
      hour: 8,
      initiator_id: 'agent_0',
      participant_ids: ['agent_0', 'agent_1'],
    });
  });

  it('归一化后仍不同的私密地点不合并', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '自家小院']]) },
      { agent_id: 'agent_1', plan: plan([[7, '自家客厅']]) },
    ];
    expect(collectEncounters({ agents, plans }).encounters).toHaveLength(0);
  });

  it('不同居民的「家」不会被当成同一个地点', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '家']]) },
      { agent_id: 'agent_1', plan: plan([[7, '家']]) },
    ];
    expect(collectEncounters({ agents, plans }).encounters).toHaveLength(0);
  });

  it('完全没有交集时补一段公共相遇，保证当天有内容可写', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '自家小院']]) },
      { agent_id: 'agent_1', plan: plan([[7, '自家客厅']]) },
    ];

    const ensured = ensureDailyEncounter({ agents, plans, hour: 12 });
    expect(ensured.injected).toBe(true);
    expect(ensured.encounters.length).toBeGreaterThanOrEqual(1);
    expect(ensured.encounters[0]).toMatchObject({ hour: 12, location: '街口' });
    expect(ensured.plans[0].plan.some((item) => item.hour === 12)).toBe(true);
    expect(ensured.plans[1].plan.some((item) => item.hour === 12)).toBe(true);
  });

  it('已有相遇时不额外补计划', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '码头']]) },
      { agent_id: 'agent_1', plan: plan([[7, '码头']]) },
    ];

    const ensured = ensureDailyEncounter({ agents, plans });
    expect(ensured.injected).toBe(false);
    expect(ensured.plans).toBe(plans);
  });

  it('单小时第 3 段起记为擦肩而过', () => {
    const positions = [
      { agent_id: 'a', agent_name: '甲', location: '码头', arrival_hour: 7, order: 0 },
      { agent_id: 'b', agent_name: '乙', location: '码头', arrival_hour: 7, order: 1 },
      { agent_id: 'c', agent_name: '丙', location: '市集', arrival_hour: 7, order: 2 },
      { agent_id: 'd', agent_name: '丁', location: '市集', arrival_hour: 7, order: 3 },
      { agent_id: 'e', agent_name: '戊', location: '学校', arrival_hour: 8, order: 4 },
      { agent_id: 'f', agent_name: '己', location: '学校', arrival_hour: 8, order: 5 },
    ];

    const { encounters, passedBy } = resolveEncounters(positions, { maxPerHour: 2 });

    expect(encounters).toHaveLength(2);
    expect(passedBy).toHaveLength(1);
    expect(passedBy[0]).toMatchObject({
      location: '学校',
      agent_ids: ['e', 'f'],
      reason: 'hour_cap',
    });
  });

  it('逐小时时间线覆盖计划中的所有小时', () => {
    const agents = makeAgents(2);
    const plans = [
      { agent_id: 'agent_0', plan: plan([[7, '码头'], [14, '码头']]) },
      { agent_id: 'agent_1', plan: plan([[9, '码头']]) },
    ];
    const timeline = buildTimeline({ agents, plans });
    expect(timeline.map((item) => item.hour)).toEqual([7, 9, 14]);
    expect(timeline[1].positions).toHaveLength(2);
  });
});
