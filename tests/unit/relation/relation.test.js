import { describe, it, expect } from 'vitest';
import { labelForAffinity } from '../../../web/domain/relation/label.js';
import {
  dialogueDelta,
  userEventDelta,
  decayDelta,
  shouldDecay,
  nextRelation,
  planRelationUpdates,
  DAILY_DELTA_CAP,
} from '../../../web/domain/relation/rules.js';

function dialogue(rounds = 3, extra = {}) {
  return {
    participant_ids: ['a', 'b'],
    transcript: Array.from({ length: rounds }, () => ({ speaker: 'a', content: '话' })),
    ...extra,
  };
}

function relation(overrides = {}) {
  return {
    town_id: 'town',
    from_agent_id: 'a',
    to_agent_id: 'b',
    affinity: 0,
    label: 'stranger',
    updated_day: 1,
    ...overrides,
  };
}

describe('关系值与标签（relation）', () => {
  it('标签映射与 §8.5 一致', () => {
    expect(labelForAffinity(-40)).toBe('knot');
    expect(labelForAffinity(-41)).toBe('knot');
    expect(labelForAffinity(5)).toBe('stranger');
    expect(labelForAffinity(9)).toBe('stranger');
    expect(labelForAffinity(10)).toBe('familiar');
    expect(labelForAffinity(49)).toBe('familiar');
    expect(labelForAffinity(50, 0)).toBe('familiar');
    expect(labelForAffinity(50, 1)).toBe('familiar');
    expect(labelForAffinity(50, 2)).toBe('friend');
  });

  it('对话变化：≥3 轮 +3，明显分歧 -4', () => {
    expect(dialogueDelta(dialogue(2))).toBe(0);
    expect(dialogueDelta(dialogue(3))).toBe(3);
    expect(dialogueDelta(dialogue(6))).toBe(3);
    expect(dialogueDelta(dialogue(3, { disagreement: true }))).toBe(-1);
    expect(dialogueDelta(dialogue(2, { disagreement: true }))).toBe(-4);
  });

  it('用户事件按强度映射到 ±2 ~ ±5', () => {
    expect(userEventDelta(0, 1)).toBe(2);
    expect(userEventDelta(1, 1)).toBe(5);
    expect(userEventDelta(1, -1)).toBe(-5);
  });

  it('单日单对变化不超过 ±8', () => {
    const dialogues = [dialogue(3), dialogue(3), dialogue(3), dialogue(3)];
    const updates = planRelationUpdates({
      townId: 'town',
      relations: [],
      dialogues,
      day: 1,
    });

    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.affinity).toBe(DAILY_DELTA_CAP);
      expect(update.updated_day).toBe(1);
    }
  });

  it('有向关系各自独立更新', () => {
    const updates = planRelationUpdates({
      townId: 'town',
      relations: [
        relation({ from_agent_id: 'a', to_agent_id: 'b', affinity: 20 }),
        relation({ from_agent_id: 'b', to_agent_id: 'a', affinity: -5 }),
      ],
      dialogues: [dialogue(3)],
      day: 2,
    });

    expect(updates.find((item) => item.from_agent_id === 'a').affinity).toBe(23);
    expect(updates.find((item) => item.from_agent_id === 'b').affinity).toBe(-2);
  });

  it('三天无互动向 0 衰减 1 点，第 2 天不衰减', () => {
    const base = relation({ affinity: 20, updated_day: 1 });

    expect(shouldDecay(base, 3)).toBe(false);
    expect(shouldDecay(base, 4)).toBe(true);

    const [update] = planRelationUpdates({
      townId: 'town',
      relations: [base],
      dialogues: [],
      day: 4,
    });
    expect(update.affinity).toBe(19);
    expect(update.updated_day).toBe(4);

    expect(
      planRelationUpdates({ townId: 'town', relations: [base], dialogues: [], day: 3 })
    ).toHaveLength(0);
  });

  it('负关系向 0 衰减时加 1', () => {
    expect(decayDelta(-12)).toBe(1);
    expect(decayDelta(12)).toBe(-1);
    expect(decayDelta(0)).toBe(0);
  });

  it('当天有互动时不衰减，且连续高亲和第 2 天升级为 friend', () => {
    const previous = relation({ affinity: 55, label: 'familiar', updated_day: 1, friend_streak: 1 });
    const updates = planRelationUpdates({
      townId: 'town',
      relations: [previous],
      dialogues: [dialogue(3)],
      day: 4,
    });

    expect(updates).toHaveLength(2);
    expect(updates[0].affinity).toBe(58);
    expect(updates[0].label).toBe('friend');
  });

  it('nextRelation 不重复累计同一天的 friend_streak', () => {
    const previous = relation({ affinity: 50, updated_day: 2, friend_streak: 1 });
    const sameDay = nextRelation({ previous, delta: 3, day: 2 });
    expect(sameDay.friend_streak).toBe(1);
    const nextDay = nextRelation({ previous: sameDay, delta: 0, day: 3 });
    expect(nextDay.friend_streak).toBe(2);
    expect(nextDay.label).toBe('friend');
  });
});
