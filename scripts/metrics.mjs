/**
 * M5-08 指标汇总：把七天的 tick 记录折算成 V1 / V4 / V5 的验收数据。
 *
 * 单独运行：
 *   npm run metrics
 *   npm run metrics -- --in test-results/seven-days-records.json --out test-results/metrics.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function round(value, digits = 6) {
  return Number(Number(value ?? 0).toFixed(digits));
}

export function summarizeTicks(records = []) {
  const durations = records.map((record) => Number(record.duration_ms ?? 0));
  const runs = new Map();
  let inputTokens = 0;
  let outputTokens = 0;
  let modelCalls = 0;

  for (const record of records) {
    const run = record.run ?? 0;
    if (!runs.has(run)) runs.set(run, { days: 0, cost: 0, done: true });
    const entry = runs.get(run);
    entry.days += 1;
    entry.cost += Number(record.usage?.cost_yuan ?? 0);
    if (record.ok === false) entry.done = false;
    inputTokens += Number(record.usage?.input_tokens ?? 0);
    outputTokens += Number(record.usage?.output_tokens ?? 0);
    modelCalls += Number(record.usage?.calls ?? 0);
  }

  const runList = [...runs.values()];
  const successRuns = runList.filter((run) => run.done && run.days >= 7).length;
  const totalCost = runList.reduce((sum, run) => sum + run.cost, 0);
  const maxRunCost = runList.reduce((max, run) => Math.max(max, run.cost), 0);

  return {
    schema_version: '1.0.0',
    generated_at: Date.now(),
    total_ticks: records.length,
    total_runs: runList.length,
    success_runs: successRuns,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    max_ms: durations.length ? Math.max(...durations) : 0,
    total_cost_yuan: round(totalCost),
    max_run_cost_yuan: round(maxRunCost),
    avg_cost_per_tick_yuan: records.length ? round(totalCost / records.length) : 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    model_calls: modelCalls,
  };
}

export async function writeMetrics(report, file = 'test-results/metrics.json') {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const input = resolve(argValue('--in', 'test-results/seven-days-records.json'));
  const output = resolve(argValue('--out', 'test-results/metrics.json'));
  let records;
  try {
    records = JSON.parse(await readFile(input, 'utf8'));
  } catch {
    console.error(`[metrics] 找不到或无法解析 ${input}`);
    process.exit(1);
  }
  const report = summarizeTicks(records);
  await writeMetrics(report, output);
  console.log(JSON.stringify(report, null, 2));
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  await main();
}
