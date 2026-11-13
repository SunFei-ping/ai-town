import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { summarizeTicks, writeMetrics } from '../../scripts/metrics.mjs';
import { makeContext, parseSSE } from '../support/tick.js';

const RUNS = 3;
const DAYS = 7;
const REMOTE = process.env.E2E_REMOTE === '1';
const REMOTE_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const TOWN_ID = process.env.E2E_TOWN_ID ?? 'town-seven';

test.skip(REMOTE && !REMOTE_API_KEY, 'E2E_REMOTE 模式需要 DEEPSEEK_API_KEY');

async function openSession(request, run, day) {
  const apiKey = REMOTE ? REMOTE_API_KEY : `sk-seven-days-${run}-${day}-1234567890`;
  const res = await request.post('/v1/session', {
    data: { api_key: apiKey },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.session_token;
}

test('seven-days：真实链路连续三次跑完七天（V1 / V4 / V5）', async ({ request }) => {
  // 远端真实模型每天约 10 秒，21 天预留 15 分钟
  test.setTimeout(REMOTE ? 900000 : 180000);

  const records = [];
  const reviews = [];

  for (let run = 0; run < RUNS; run += 1) {
    for (let day = 1; day <= DAYS; day += 1) {
      const token = await openSession(request, run, day);
      const started = Date.now();
      const res = await request.post(`/v1/towns/${TOWN_ID}/tick`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `run-${run}-day-${day}`,
        },
        data: { day_index: day, context: makeContext({ townId: TOWN_ID, day }) },
      });

      const text = await res.text();
      expect(res.status(), `第 ${run + 1} 轮第 ${day} 天：${text.slice(0, 200)}`).toBe(200);

      const frames = parseSSE(text);
      const done = frames.find((frame) => frame.event === 'done');
      const error = frames.find((frame) => frame.event === 'error');
      expect(error, `第 ${run + 1} 轮第 ${day} 天不应有 error 帧`).toBeUndefined();
      expect(done, `第 ${run + 1} 轮第 ${day} 天缺少 done 帧`).toBeTruthy();
      const reportFrame = frames.find((frame) => frame.event === 'report_ready');
      expect(reportFrame, `第 ${run + 1} 轮第 ${day} 天缺少 report_ready 帧`).toBeTruthy();
      reviews.push({ run: run + 1, day, report: reportFrame.data.report });

      records.push({
        run: run + 1,
        day,
        ok: Boolean(done),
        duration_ms: Date.now() - started,
        usage: done.data.usage,
      });
    }
  }

  // 保存每天的小报，供 §12.3 主观评审使用
  const reviewRoot = resolve('test-results/quality-review');
  for (const item of reviews) {
    const runDir = resolve(reviewRoot, `run-${item.run}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      resolve(runDir, `day-${item.day}.json`),
      `${JSON.stringify(item.report, null, 2)}\n`,
      'utf8'
    );
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
