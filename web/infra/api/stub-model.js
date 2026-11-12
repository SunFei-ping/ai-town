/**
 * 桩模型：M1 阶段用于跑通编排，不触网、结果确定。
 * M5-04 会用真实的 SSE 客户端替换它，领域层不感知差别。
 *
 * 模型端口约定（后续真实实现必须一致）：
 *   complete({ stage, agent, day, town, payload }) -> Promise<object>
 */
export function createStubModel({ failOn = null, delayMs = 0 } = {}) {
  let calls = 0;

  async function complete({ stage, agent, day }) {
    calls += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (failOn === stage) throw new Error(`stub failure at ${stage}`);

    if (stage === 'plan') {
      const place = agent.occupation ?? '街上';
      return {
        plan: [
          { hour: 7, location: place, intent: '开门' },
          { hour: 10, location: place, intent: '做事' },
          { hour: 14, location: '码头', intent: '透口气' },
          { hour: 18, location: place, intent: '收摊' },
        ],
      };
    }

    if (stage === 'unsay') {
      return {
        text: `${agent.name}今天在码头站了一会儿，有句话到了嘴边，最后咽回去了。`,
      };
    }

    if (stage === 'dialogue') {
      return { rounds: [] };
    }

    throw new Error(`stub 不支持的阶段：${stage}`);
  }

  return {
    complete,
    get calls() {
      return calls;
    },
  };
}
