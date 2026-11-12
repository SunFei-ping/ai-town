import { describe, it, expect } from 'vitest';
import tickHandler from '../../functions/tick/index.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import { LocalKV, framesOfType, makeContext, openSession, readFrames, tickRequest } from '../support/tick.js';

async function runTick({ budgetYuan } = {}) {
  const kv = new LocalKV();
  const { token } = await openSession({ kv });
  const model = createStubModel();
  const usage = [];

  const result = await tickHandler(
    tickRequest({
      kv,
      token,
      model,
      budgetYuan,
      onUsage: (record) => usage.push(record),
      body: { day_index: 1, context: makeContext() },
    })
  );
  const frames = await readFrames(result);
  return { frames, usage, model };
}

describe('用量计量与成本护栏（budget-guard）', () => {
  it('每次模型调用写 1 条 USAGE，done 汇总与调用一致', async () => {
    const { frames, usage, model } = await runTick({ budgetYuan: 5 });

    expect(usage.length).toBe(model.calls);
    expect(usage.length).toBeGreaterThan(0);
    for (const record of usage) {
      expect(record.town_id).toBe('town-test');
      expect(record.day).toBe(1);
      expect(['plan', 'dialogue', 'unsay'].includes(record.stage)).toBe(true);
      expect(record.input_tokens).toBeGreaterThan(0);
      expect(record.output_tokens).toBeGreaterThan(0);
    }

    const done = framesOfType(frames, 'done')[0].data;
    expect(done.usage.calls).toBe(usage.length);
    expect(done.usage.cost_yuan).toBeGreaterThan(0);
    expect(framesOfType(frames, 'warning')).toHaveLength(0);
  });

  it('超过护栏发 W_BUDGET_GUARD 并降级，但流继续到 done', async () => {
    const { frames } = await runTick({ budgetYuan: 0.000001 });

    const warnings = framesOfType(frames, 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].data.code).toBe('W_BUDGET_GUARD');

    expect(framesOfType(frames, 'report_ready')).toHaveLength(1);
    const done = framesOfType(frames, 'done');
    expect(done).toHaveLength(1);
    expect(done[0].data.usage.calls).toBeGreaterThan(0);
  });

  it('护栏触发后对话轮次上限降到 4', async () => {
    const kv = new LocalKV();
    const { token } = await openSession({ kv });
    const context = makeContext();

    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        budgetYuan: 0.000001,
        body: { day_index: 1, context },
      })
    );
    const frames = await readFrames(result);
    const dialogues = framesOfType(frames, 'dialogue');
    expect(dialogues.length).toBeGreaterThan(0);
    for (const frame of dialogues) {
      expect(frame.data.rounds.length).toBeLessThanOrEqual(4);
    }
  });
});
