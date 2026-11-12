import { describe, it, expect } from 'vitest';
import {
  ensureUnsays,
  fallbackUnsay,
  isValidUnsay,
  UNSAY_MAX_REBUILDS,
} from '../../../web/domain/report/unsay.js';

const AGENTS = ['陈望', '林小满', '周秀兰', '阿彪', '苗苗'].map((name, index) => ({
  id: `a${index}`,
  name,
}));

function validText(agent) {
  return `${agent.name}今天把一句话留在了心里，直到天黑也没有说出口。`;
}

describe('unsaid 与 C6（unsay）', () => {
  it('已有 3 条时只补缺的 2 条，重建次数为 2', async () => {
    let calls = 0;
    const existing = AGENTS.slice(0, 3).map((agent) => ({
      agent_id: agent.id,
      text: validText(agent),
    }));

    const result = await ensureUnsays({
      agents: AGENTS,
      unsays: existing,
      regenerate: async (agent) => {
        calls += 1;
        return validText(agent);
      },
    });

    expect(result.unsays).toHaveLength(5);
    expect(result.rebuilds).toBe(2);
    expect(calls).toBe(2);
    expect(result.degraded).toBe(false);
    expect(new Set(result.unsays.map((item) => item.text)).size).toBe(5);
  });

  it('重建最多 2 次，仍失败则用兜底句并标记降级', async () => {
    let calls = 0;
    const result = await ensureUnsays({
      agents: [AGENTS[0]],
      unsays: [],
      regenerate: async () => {
        calls += 1;
        throw new Error('模型失败');
      },
    });

    expect(calls).toBe(UNSAY_MAX_REBUILDS);
    expect(result.rebuilds).toBe(UNSAY_MAX_REBUILDS);
    expect(result.degraded).toBe(true);
    expect(result.unsays).toHaveLength(1);
    expect(result.unsays[0].text).toBe(fallbackUnsay(AGENTS[0]));
  });

  it('空文本或超长文本视为缺失并重建', async () => {
    const result = await ensureUnsays({
      agents: [AGENTS[0]],
      unsays: [{ agent_id: AGENTS[0].id, text: '   ' }],
      regenerate: async (agent) => validText(agent),
    });

    expect(result.rebuilds).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.unsays[0].text).toBe(validText(AGENTS[0]));
  });

  it('重复的同一居民只保留第一条', async () => {
    const result = await ensureUnsays({
      agents: [AGENTS[0]],
      unsays: [
        { agent_id: AGENTS[0].id, text: '第一条独白内容足够长，可以保留下来。' },
        { agent_id: AGENTS[0].id, text: '第二条独白不应该覆盖第一条内容。' },
      ],
      regenerate: async () => '不应该被调用，这一句足够长了吧。',
    });

    expect(result.unsays).toHaveLength(1);
    expect(result.unsays[0].text).toBe('第一条独白内容足够长，可以保留下来。');
    expect(result.rebuilds).toBe(0);
  });

  it('isValidUnsay 只接受 1–120 字的非空文本', () => {
    expect(isValidUnsay('一句正常的话')).toBe(true);
    expect(isValidUnsay('')).toBe(false);
    expect(isValidUnsay('  ')).toBe(false);
    expect(isValidUnsay('长'.repeat(121))).toBe(false);
  });
});
