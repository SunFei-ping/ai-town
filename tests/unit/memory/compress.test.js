import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../../support/db.js';
import * as dao from '../../../web/infra/storage/dao.js';
import { createEventMemory } from '../../../web/domain/memory/tier.js';
import { compressDay, buildSummaryText, EMPTY_DAY_SUMMARY } from '../../../web/domain/memory/compress.js';

async function setupAgent() {
  const town = await dao.createTown(
    { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
    fiveAgents()
  );
  const [agent] = await dao.listAgents(town.id);
  return { town, agent };
}

beforeEach(async () => {
  await resetDB();
});

describe('每日压缩（compress）', () => {
  it('当天事件压成 1 条 ≤80 字的总结，原文被删除', async () => {
    const { agent } = await setupAgent();
    await dao.putMemory(createEventMemory({ agent_id: agent.id, content: '上午去了码头。', created_day: 1 }));
    await dao.putMemory(createEventMemory({ agent_id: agent.id, content: '下午在店里修收音机。', created_day: 1 }));

    const summaries = await compressDay({ agents: [agent], day: 1 });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].content.length).toBeLessThanOrEqual(80);
    expect(summaries[0].content).toContain('码头');

    const events = await dao.listMemories(agent.id, 'event');
    expect(events.filter((memory) => memory.created_day === 1)).toHaveLength(0);

    const stored = await dao.listMemories(agent.id, 'summary');
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe(summaries[0].content);
  });

  it('重复压缩不追加总结，仍只有 1 条', async () => {
    const { agent } = await setupAgent();
    await dao.putMemory(createEventMemory({ agent_id: agent.id, content: '去了码头', created_day: 1 }));

    await compressDay({ agents: [agent], day: 1 });
    await compressDay({ agents: [agent], day: 1 });

    const stored = await dao.listMemories(agent.id, 'summary');
    expect(stored).toHaveLength(1);
  });

  it('没有事件的当天也生成 1 条总结，且不删除历史总结', async () => {
    const { agent } = await setupAgent();
    await dao.putMemory(createEventMemory({ agent_id: agent.id, content: '第一天的事', created_day: 1 }));
    await compressDay({ agents: [agent], day: 1 });

    await compressDay({ agents: [agent], day: 2 });

    const stored = await dao.listMemories(agent.id, 'summary');
    expect(stored).toHaveLength(2);
    expect(stored.find((memory) => memory.created_day === 2).content).toBe(EMPTY_DAY_SUMMARY);
  });

  it('超长内容截断到 80 字以内', () => {
    const text = buildSummaryText([
      { content: '甲'.repeat(60) },
      { content: '乙'.repeat(60) },
    ]);
    expect(text.length).toBe(80);
    expect(text.endsWith('…')).toBe(true);
  });
});
