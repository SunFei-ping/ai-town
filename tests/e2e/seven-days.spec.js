import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { summarizeTicks, writeMetrics } from '../../scripts/metrics.mjs';
import { makeContext, parseSSE } from '../support/tick.js';

const RUNS = 3;
const DAYS = 7;

async function openSession(request, run, day) {
  const res = await request.post('/v1/session', {
    data: { api_key: `sk-seven-days-${run}-${day}-1234567890` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.session_token;
}

test('seven-days：真实链路连续三次跑完七天（V1 / V4 / V5）', async ({ request }) => {
  test.setTimeout(180000);

  const records = [];

  for (let run = 0; run < RUNS; run += 1) {
    for (let day = 1; day <= DAYS; day += 1) {
      const token = await openSession(request, run, day);
      const started = Date.now();
      const res = await request.post('/v1/towns/town-seven/tick', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `run-${run}-day-${day}`,
        },
        data: { day_index: day, context: makeContext({ townId: 'town-seven', day }) },
      });

      const text = await res.text();
      expect(res.status(), `第 ${run + 1} 轮第 ${day} 天：${text.slice(0, 200)}`).toBe(200);

      const frames = parseSSE(text);
      const done = frames.find((frame) => frame.event === 'done');
      const error = frames.find((frame) => frame.event === 'error');
      expect(error, `第 ${run + 1} 轮第 ${day} 天不应有 error 帧`).toBeUndefined();
      expect(done, `第 ${run + 1} 轮第 ${day} 天缺少 done 帧`).toBeTruthy();
      expect(frames.filter((frame) => frame.event === 'report_ready')).toHaveLength(1);

      records.push({
        run: run + 1,
        day,
        ok: Boolean(done),
        duration_ms: Date.now() - started,
        usage: done.data.usage,
      });
    }
  }

  const report = summarizeTicks(records);
  const recordsPath = resolve('test-results/seven-days-records.json');
  await mkdir(dirname(recordsPath), { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await writeMetrics(report, 'test-results/metrics.json');

  // V1：连续 3 次通过
  expect(report.success_runs).toBe(RUNS);
  // V4：单次 Tick P95 ≤ 150 秒
  expect(report.p95_ms).toBeLessThanOrEqual(150000);
  // V5：单局成本 ≤ 5 元
  expect(report.max_run_cost_yuan).toBeLessThanOrEqual(5);
});
