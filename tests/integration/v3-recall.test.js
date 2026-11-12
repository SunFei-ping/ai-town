import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import { createEventMemory } from '../../web/domain/memory/tier.js';
import { runDay } from '../../web/domain/simulation/day.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';

const DETAIL = '蓝色的铁皮盒子';

/**
 * 注入第 1 天细节；第 5 天只依据上下文里的总结层把它引用出来。
 * 断言只检查产物文本，不涉及任何问答或对话接口。
 */
function createRecallModel() {
  const stub = createStubModel();
  return {
    async complete(params) {
      if (params.stage === 'unsay' && params.day === 5) {
        const remembered = (params.context?.agents ?? []).some((agent) =>
          (agent.memories?.summaries ?? []).some((summary) => summary.content.includes(DETAIL))
        );
        return {
          text: remembered
            ? `他还记得第 1 天那个${DETAIL}，只是没再打开过。`
            : '他什么也想不起来了。',
        };
      }
      return stub.complete(params);
    },
  };
}

beforeEach(async () => {
  await resetDB();
});

describe('V3：第 1 天细节在第 5 天被引用（v3-recall）', () => {
  it('细节通过总结层进入第 5 天上下文，并出现在产物文本中', async () => {
    let town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const model = createRecallModel();

    for (let day = 1; day <= 5; day += 1) {
      const agents = await dao.listAgents(town.id);

      if (day === 1) {
        // 注入细节：写在当天事件层，日终会被压进总结层
        for (const agent of agents) {
          await dao.putMemory(
            createEventMemory({
              agent_id: agent.id,
              content: `在码头看见一个${DETAIL}，没敢碰。`,
              created_day: 1,
              weight: 8,
            })
          );
        }
      }

      const outcome = await runDay({ town, agents, day, model });
      town = outcome.town;

      if (day === 1) {
        // 当天事件已压缩，细节只保留在总结层
        for (const agent of agents) {
          const summaries = await dao.listMemories(agent.id, 'summary');
          expect(summaries.find((memory) => memory.created_day === 1)?.content).toContain(DETAIL);
          const events = await dao.listMemories(agent.id, 'event');
          expect(events.filter((memory) => memory.created_day === 1)).toHaveLength(0);
        }
      }

      if (day === 5) {
        expect(outcome.unsays).toHaveLength(5);
        const recalled = outcome.unsays.filter((unsay) => unsay.text.includes(DETAIL));
        expect(recalled.length).toBeGreaterThan(0);
      }
    }
  });
});
