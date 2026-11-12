import { describe, it, expect } from 'vitest';
import tickHandler from '../../functions/tick/index.js';
import { createRuntimeKV, kvKeys, SNAPSHOT_TTL_SECONDS } from '../../functions/runtime/kv.js';
import { LocalKV, makeContext, openSession, readFrames, tickRequest } from '../support/tick.js';

async function setup() {
  const kv = new LocalKV();
  const { token } = await openSession({ kv });
  return { kv, token, runtime: createRuntimeKV(kv) };
}

const FRAMES = [
  { id: 1, event: 'accepted', data: { tick_id: 'tick-old' } },
  { id: 2, event: 'planning', data: { agent_id: 'agent-0', plan: [] } },
  { id: 3, event: 'dialogue', data: { location: '码头', hour: 14, participants: [], rounds: [] } },
  { id: 4, event: 'report_ready', data: { report: { day: 1 } } },
  { id: 5, event: 'done', data: { day_index: 1, usage: { calls: 1 } } },
];

describe('续传与快照（resume）', () => {
  it('已结束的 tick 只补发 Last-Event-ID 之后的帧，不重跑模型', async () => {
    const { kv, token, runtime } = await setup();
    await runtime.saveSnapshot('town-test', 1, {
      tick_id: 'tick-old',
      town_id: 'town-test',
      day_index: 1,
      frames: FRAMES,
      done: true,
    });

    let modelCalls = 0;
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        headers: { 'last-event-id': '2' },
        model: {
          async complete() {
            modelCalls += 1;
            throw new Error('续传不应调用模型');
          },
        },
        body: { day_index: 1, context: makeContext() },
      })
    );

    expect(result.status).toBe(200);
    const frames = await readFrames(result);
    expect(frames.map((frame) => frame.id)).toEqual([3, 4, 5]);
    expect(modelCalls).toBe(0);

    const ttl = kv.ttlMs(kvKeys.snapshot('town-test', 1));
    expect(ttl).toBeGreaterThan((SNAPSHOT_TTL_SECONDS - 1) * 1000);
    expect(ttl).toBeLessThanOrEqual(SNAPSHOT_TTL_SECONDS * 1000);
  });

  it('进行中的 tick 会持续补齐快照里的新帧', async () => {
    const { kv, token, runtime } = await setup();
    await runtime.saveSnapshot('town-test', 1, {
      tick_id: 'tick-live',
      town_id: 'town-test',
      day_index: 1,
      frames: FRAMES.slice(0, 2),
      done: false,
    });

    setTimeout(() => {
      runtime.saveSnapshot('town-test', 1, {
        tick_id: 'tick-live',
        town_id: 'town-test',
        day_index: 1,
        frames: FRAMES.slice(0, 4),
        done: false,
      });
    }, 120);
    setTimeout(() => {
      runtime.saveSnapshot('town-test', 1, {
        tick_id: 'tick-live',
        town_id: 'town-test',
        day_index: 1,
        frames: FRAMES,
        done: true,
      });
    }, 260);

    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        headers: { 'last-event-id': '2' },
        body: { day_index: 1, context: makeContext() },
      })
    );
    const frames = await readFrames(result);
    expect(frames.map((frame) => frame.id)).toEqual([3, 4, 5]);
  });

  it('没有快照时续传返回 E_TOWN_STATE', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        headers: { 'last-event-id': '3' },
        body: { day_index: 1, context: makeContext() },
      })
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('E_TOWN_STATE');
  });
});
