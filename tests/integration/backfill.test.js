import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import * as db from '../../web/infra/storage/idb.js';
import { runDay } from '../../web/domain/simulation/day.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import {
  REALTIME_DAY_MS,
  computeBackfillPlan,
  runBackfill,
} from '../../web/domain/simulation/backfill.js';
import { WARNING_CODES } from '../../shared/errors/codes.js';

const DAY = REALTIME_DAY_MS;

async function setupRealtimeTown({ elapsedDays = 3, now = Date.now() } = {}) {
  const town = await dao.createTown(
    { name: '测试镇', templateId: 'seaside', paceMode: 'realtime' },
    fiveAgents()
  );
  const base = now - elapsedDays * DAY - 1000;
  const backdated = { ...town, created_at: base, last_tick_at: base };
  await db.put('town', backdated);
  return { town: backdated, agents: await dao.listAgents(town.id), base, now };
}

function fakeAdvance({ calls }) {
  return async ({ town, day, lastTickAt }) => {
    calls.push({ day, lastTickAt });
    const updated = await dao.updateTownDay(town.id, day, { lastTickAt });
    return { town: updated, plans: [], dialogues: [], unsays: [] };
  };
}

beforeEach(async () => {
  await resetDB();
});

describe('真实时间补算（backfill）', () => {
  it('按 last_tick_at 折算可解锁天数，单批最多 2 天', async () => {
    const { town, now } = await setupRealtimeTown({ elapsedDays: 3 });
    const plan = computeBackfillPlan({ town, now, dayMs: DAY });

    expect(plan.unlocked).toBe(3);
    expect(plan.batch).toBe(2);
    expect(plan.capped).toBe(true);
    expect(plan.remaining).toBe(1);
  });

  it('快进模式不补算', async () => {
    const town = await dao.createTown(
      { name: '快进镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const plan = computeBackfillPlan({ town, dayMs: DAY });
    expect(plan.unlocked).toBe(0);
    expect(plan.batch).toBe(0);
  });

  it('每天完成立即落盘，超出发 W_BACKFILL_CAPPED，剩余天数下次继续', async () => {
    const { town, now, base } = await setupRealtimeTown({ elapsedDays: 3 });
    const calls = [];
    const warnings = [];
    const done = [];

    const first = await runBackfill({
      town,
      now,
      dayMs: DAY,
      advanceDay: fakeAdvance({ calls }),
      onWarning: (warning) => warnings.push(warning),
      onDayDone: async (outcome, meta) => done.push(meta.day),
    });

    expect(first.completed).toBe(2);
    expect(calls.map((call) => call.day)).toEqual([1, 2]);
    expect(done).toEqual([1, 2]);
    expect(warnings.map((warning) => warning.code)).toEqual([WARNING_CODES.W_BACKFILL_CAPPED]);
    expect(first.remaining).toBe(1);

    const persisted = await dao.getTown(town.id);
    expect(persisted.day_index).toBe(2);
    expect(persisted.last_tick_at).toBe(base + 2 * DAY);

    // 同一次打开里继续补算剩余 1 天
    const planAgain = computeBackfillPlan({ town: persisted, now, dayMs: DAY });
    expect(planAgain.unlocked).toBe(1);
    expect(planAgain.capped).toBe(false);

    const second = await runBackfill({
      town: persisted,
      now,
      dayMs: DAY,
      advanceDay: fakeAdvance({ calls }),
    });
    expect(second.completed).toBe(1);
    expect((await dao.getTown(town.id)).day_index).toBe(3);
  });

  it('中断后已完成的天保留，下次只补剩余天数', async () => {
    const { town, now } = await setupRealtimeTown({ elapsedDays: 3 });
    let count = 0;

    await expect(
      runBackfill({
        town,
        now,
        dayMs: DAY,
        advanceDay: async ({ town: current, day, lastTickAt }) => {
          count += 1;
          if (count === 2) throw new Error('页面被关闭');
          const updated = await dao.updateTownDay(current.id, day, { lastTickAt });
          return { town: updated };
        },
      })
    ).rejects.toThrow('页面被关闭');

    const persisted = await dao.getTown(town.id);
    expect(persisted.day_index).toBe(1);

    const plan = computeBackfillPlan({ town: persisted, now, dayMs: DAY });
    expect(plan.unlocked).toBe(2);
    expect(plan.batch).toBe(2);
  });

  it('补算产生的小报标记 generation_mode=backfill', async () => {
    const now = Date.now();
    const { town, agents } = await setupRealtimeTown({ elapsedDays: 1, now });

    const result = await runBackfill({
      town,
      now,
      dayMs: DAY,
      advanceDay: ({ town: current, day, lastTickAt }) =>
        runDay({
          town: current,
          agents,
          day,
          model: createStubModel(),
          generationMode: 'backfill',
          lastTickAt,
        }),
    });

    expect(result.completed).toBe(1);
    expect(result.outcomes[0].report.generation_mode).toBe('backfill');
    const stored = await dao.getReport(town.id, 1);
    expect(stored.generation_mode).toBe('backfill');
  });
});
