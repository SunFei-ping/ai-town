import { describe, it, expect } from 'vitest';
import {
  createEventMemory,
  createSummaryMemory,
  createImpressionMemory,
  createDialogueMemories,
} from '../../../web/domain/memory/tier.js';

describe('记忆三层写入规则（memory-tier）', () => {
  it('event 层：expire_day 等于 created_day，超过 300 字被拒', () => {
    const memory = createEventMemory({ agent_id: 'a1', content: '在码头站了一会儿', created_day: 1 });
    expect(memory.tier).toBe('event');
    expect(memory.expire_day).toBe(1);
    expect(memory.target_agent_id).toBeNull();

    expect(() =>
      createEventMemory({ agent_id: 'a1', content: 'a'.repeat(301), created_day: 1 })
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));
  });

  it('summary 层：≤80 字，expire_day 为 null', () => {
    const memory = createSummaryMemory({ agent_id: 'a1', content: '今天去了码头', created_day: 2 });
    expect(memory.tier).toBe('summary');
    expect(memory.expire_day).toBeNull();
    expect(memory.target_agent_id).toBeNull();

    expect(() =>
      createSummaryMemory({ agent_id: 'a1', content: 'b'.repeat(81), created_day: 2 })
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));
  });

  it('impression 层：必须带 target_agent_id，≤120 字，expire_day 为 null', () => {
    const memory = createImpressionMemory({
      agent_id: 'a1',
      target_agent_id: 'a2',
      content: '这丫头来得太急',
      created_day: 2,
    });
    expect(memory.tier).toBe('impression');
    expect(memory.target_agent_id).toBe('a2');
    expect(memory.expire_day).toBeNull();

    expect(() =>
      createImpressionMemory({ agent_id: 'a1', content: '没有对象', created_day: 2 })
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));

    expect(() =>
      createImpressionMemory({
        agent_id: 'a1',
        target_agent_id: 'a2',
        content: 'c'.repeat(121),
        created_day: 2,
      })
    ).toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));
  });

  it('一段对话为双方各写 1 条事件记忆', () => {
    const agents = [
      { id: 'a1', name: '甲' },
      { id: 'a2', name: '乙' },
    ];
    const dialogue = {
      day: 1,
      location: '码头',
      participant_ids: ['a1', 'a2'],
      transcript: [{ speaker: '甲', content: '今天人不多。' }],
    };

    const memories = createDialogueMemories({ dialogue, agents });
    expect(memories).toHaveLength(2);
    expect(memories.map((memory) => memory.agent_id).sort()).toEqual(['a1', 'a2']);
    expect(memories.map((memory) => memory.target_agent_id).sort()).toEqual(['a1', 'a2']);
    for (const memory of memories) {
      expect(memory.tier).toBe('event');
      expect(memory.created_day).toBe(1);
      expect(memory.expire_day).toBe(1);
    }
  });
});
