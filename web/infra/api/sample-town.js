/**
 * 示例小镇加载：静态 JSON，断网可用，全程不调用模型（V8）。
 * 数据结构见 docs/spcd.md §5 / ADR-007。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { validateReport } from '../../../shared/contracts/report.js';

async function readJson(path) {
  const res = await fetch(path);
  if (!res.ok) fail(ERROR_CODES.E_INTERNAL, `示例数据加载失败：${path}`);
  return res.json();
}

export async function loadSampleTown() {
  const data = await readJson('/data/sample-town/town.json');
  const town = data?.town;
  const agents = data?.agents;
  if (!town || !Array.isArray(agents) || agents.length === 0) {
    fail(ERROR_CODES.E_INTERNAL, '示例小镇数据不完整');
  }

  const days = Number.isInteger(town.day_index) ? town.day_index : 0;
  const reports = [];
  for (let day = 1; day <= days; day += 1) {
    const report = await readJson(`/data/sample-town/reports/day-${day}.json`);
    reports.push(validateReport(report));
  }

  return { town, agents, reports, summary: data.summary ?? '' };
}
