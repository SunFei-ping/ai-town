import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../../support/db.js';
import * as dao from '../../../web/infra/storage/dao.js';
import { upsertImpression, listImpressions, getImpression } from '../../../web/domain/memory/impression.js';

async function setupAgents() {
  const town = await dao.createTown(
    { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
    fiveAgents()
  );
  return dao.listAgents(town.id);
}

beforeEach(async () => {
  await resetDB();
});

describe('印象层覆盖更新（impression）', () => {
  it('同一 target 重复写入后仍只有 1 条，内容取新值（C4）', async () => {
    const [first, second] = await setupAgents();

    await upsertImpression({
      agent_id: first.id,
      target_agent_id: second.id,
      content: '这丫头来得太急',
      day: 2,
    });
    await upsertImpression({
      agent_id: first.id,
      target_agent_id: second.id,
      content: '她其实挺能扛事',
      day: 4,
    });

    const impressions = await listImpressions(first.id);
    expect(impressions).toHaveLength(1);
    expect(impressions[0].content).toBe('她其实挺能扛事');
    expect(impressions[0].created_day).toBe(4);
    expect(impressions[0].expire_day).toBeNull();
  });

  it('不同 target 各自保留 1 条', async () => {
    const agents = await setupAgents();
    for (let index = 1; index < agents.length; index += 1) {
      await upsertImpression({
        agent_id: agents[0].id,
        target_agent_id: agents[index].id,
        content: `对${agents[index].name}的印象`,
        day: 3,
      });
    }

    const impressions = await listImpressions(agents[0].id);
    expect(impressions).toHaveLength(4);
    const sample = await getImpression(agents[0].id, agents[2].id);
    expect(sample.content).toBe(`对${agents[2].name}的印象`);
  });
});
