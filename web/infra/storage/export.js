/**
 * 导出与回导，见 SPCD §6.5 与 task.md M6-04。
 *
 * town.json：包含全部 11 张表的数据与 schema_version，可重新导入继续推进。
 * town.md：面向普通读者，只保留人名、故事与心事的可读文本，不暴露数据结构。
 */
import * as db from './idb.js';
import * as dao from './dao.js';
import { STORES } from './schema.js';
import {
  LIMITS,
  PACE_MODES,
  REPORT_GENERATION_MODES,
  SCHEMA_VERSION,
  isSchemaCompatible,
} from '../../../shared/contracts/index.js';
import { LABEL_TEXT } from '../../domain/relation/label.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

const TABLE_NAMES = Object.freeze([
  'agent',
  'day_state',
  'memory',
  'relation',
  'event',
  'dialogue',
  'daily_report',
  'report_section',
  'unsay',
  'usage',
]);

const PACE_TEXT = Object.freeze({
  quick: '快进',
  realtime: '真实时间',
});

const MODE_TEXT = Object.freeze({
  normal: '',
  backfill: '（补算）',
  degraded: '（兜底）',
});

function byId(a, b) {
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function safeFileName(name) {
  return String(name ?? 'ai-town')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ai-town';
}

function assert(condition, message) {
  if (!condition) throw new AppError(ERROR_CODES.E_VALIDATION, message);
}

/* ------------------------------ 导出 ------------------------------ */

export async function collectTown(townId) {
  const town = await dao.getTown(townId);
  const agents = (await dao.listAgents(townId)).sort(byId);

  const memories = [];
  for (const agent of agents) {
    memories.push(...(await dao.listAllMemories(agent.id)));
  }

  const reports = await dao.listReports(townId);
  const sections = [];
  const unsays = [];
  for (const report of reports) {
    sections.push(...(await db.getAllByIndex('report_section', 'by_report', report.id)));
    unsays.push(...(await db.getAllByIndex('unsay', 'by_report', report.id)));
  }

  const tables = {
    agent: agents,
    day_state: (await db.getAllByIndexPrefix('day_state', 'by_town_day', [townId])).sort(byId),
    memory: memories.sort(byId),
    relation: (await dao.listRelations(townId)).sort(byId),
    event: (await db.getAllByIndexPrefix('event', 'by_town_day', [townId])).sort(byId),
    dialogue: (await db.getAllByIndexPrefix('dialogue', 'by_town_day_hour', [townId])).sort(byId),
    daily_report: reports.sort(byId),
    report_section: sections.sort(byId),
    unsay: unsays.sort(byId),
    usage: (await db.getAllByIndexPrefix('usage', 'by_town_day', [townId])).sort(byId),
  };

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: Date.now(),
    town,
    tables,
  };
}

export async function exportTownJson(townId) {
  const payload = await collectTown(townId);
  return {
    filename: `${safeFileName(payload.town.name)}-town.json`,
    content: JSON.stringify(payload, null, 2),
  };
}

function memoriesFor(memories, agentId, tier) {
  return memories
    .filter((memory) => memory.agent_id === agentId && memory.tier === tier)
    .sort((a, b) => (a.created_day ?? 0) - (b.created_day ?? 0));
}

function renderAgentMarkdown({ agent, agents, memories, relations }) {
  const lines = [];
  lines.push(`### ${agent.name}（${agent.age} 岁，${agent.occupation}）`);
  lines.push('');
  if (agent.persona) lines.push(`- 人设：${agent.persona}`);
  if (agent.secret) lines.push(`- 秘密：${agent.secret}`);
  if (agent.conflict_goal) lines.push(`- 想要：${agent.conflict_goal}`);
  if (agent.speech_style) lines.push(`- 说话：${agent.speech_style}`);
  if (agent.current_location) lines.push(`- 现在在：${agent.current_location}`);

  const impressions = memoriesFor(memories, agent.id, 'impression');
  if (impressions.length > 0) {
    lines.push('');
    lines.push('他/她心里的别人：');
    for (const impression of impressions) {
      const target = agents.find((item) => item.id === impression.target_agent_id);
      lines.push(`- 对${target?.name ?? '某人'}：${impression.content}`);
    }
  }

  const summaries = memoriesFor(memories, agent.id, 'summary');
  if (summaries.length > 0) {
    lines.push('');
    lines.push('记得的日子：');
    for (const summary of summaries) {
      lines.push(`- 第 ${summary.created_day} 天：${summary.content}`);
    }
  }

  const outgoing = relations.filter((relation) => relation.from_agent_id === agent.id);
  if (outgoing.length > 0) {
    lines.push('');
    lines.push('关系：');
    for (const relation of outgoing) {
      const target = agents.find((item) => item.id === relation.to_agent_id);
      lines.push(
        `- 对${target?.name ?? '某人'}：${LABEL_TEXT[relation.label] ?? relation.label}（${relation.affinity}）`
      );
    }
  }

  lines.push('');
  return lines;
}

function renderReportMarkdown({ report, sections, unsays }) {
  const lines = [];
  lines.push(`#### 第 ${report.day} 天 · ${report.headline}${MODE_TEXT[report.generation_mode] ?? ''}`);
  lines.push('');
  for (const section of [...sections].sort((a, b) => a.order - b.order)) {
    lines.push(`**${section.title}**`);
    lines.push('');
    for (const line of String(section.body ?? '').split('\n')) {
      if (line.trim()) lines.push(line.trim());
    }
    lines.push('');
  }
  if (unsays.length > 0) {
    lines.push('没说出口的话：');
    for (const unsay of unsays) {
      lines.push(`- ${unsay.agent_name ?? '有人'}：${unsay.text}`);
    }
    lines.push('');
  }
  return lines;
}

export async function exportTownMarkdown(townId) {
  const { town, tables } = await collectTown(townId);
  const {
    agent: agents,
    memory,
    relation,
    event,
    daily_report,
    report_section,
    unsay,
  } = tables;
  const lines = [];

  lines.push(`# ${town.name}`);
  lines.push('');
  lines.push(
    `第 ${town.day_index} 天 / 共 ${LIMITS.DAYS_PER_TOWN} 天 · ${
      PACE_TEXT[town.pace_mode] ?? town.pace_mode
    } · ${town.status === 'completed' ? '这一周已经结束' : '还在继续'}`
  );
  lines.push('');
  lines.push('本故事由 AI 虚构生成。');
  lines.push('');

  lines.push('## 居民');
  lines.push('');
  for (const agent of agents) {
    lines.push(...renderAgentMarkdown({ agent, agents, memories: memory, relations: relation }));
  }

  if (event.length > 0) {
    lines.push('## 从外面吹进来的事');
    lines.push('');
    for (const item of event) {
      lines.push(`- 第 ${item.day} 天：${item.payload}`);
    }
    lines.push('');
  }

  if (daily_report.length > 0) {
    lines.push('## 每日小报');
    lines.push('');
    for (const report of daily_report) {
      const daySections = report_section.filter((section) => section.report_id === report.id);
      const dayUnsays = unsay.filter((item) => item.report_id === report.id);
      lines.push(...renderReportMarkdown({ report, sections: daySections, unsays: dayUnsays }));
    }
  }

  const dialogueCount = tables.dialogue.length;
  lines.push('---');
  lines.push('');
  lines.push(
    `本文件由「${town.name}」导出：${agents.length} 位居民，${town.day_index} 天，${dialogueCount} 段对话。`
  );
  lines.push('');

  return {
    filename: `${safeFileName(town.name)}-town.md`,
    content: lines.join('\n'),
  };
}

/* ------------------------------ 回导 ------------------------------ */

function parsePayload(input) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      assert(false, '导入文件不是合法的 JSON');
    }
  }
  assert(input && typeof input === 'object', '导入内容必须是 JSON 对象');
  return input;
}

function validatePayload(payload) {
  assert(typeof payload.schema_version === 'string', '导入文件缺少 schema_version');
  if (!isSchemaCompatible(SCHEMA_VERSION, payload.schema_version)) {
    throw new AppError(
      ERROR_CODES.E_VALIDATION,
      `导出文件的版本 ${payload.schema_version} 与当前版本 ${SCHEMA_VERSION} 不兼容，请先导出备份后再升级`
    );
  }
  assert(payload.town && typeof payload.town === 'object', '导入文件缺少小镇信息');
  assert(typeof payload.town.id === 'string' && payload.town.id, '导入文件的小镇 id 不合法');
  assert(payload.tables && typeof payload.tables === 'object', '导入文件缺少表数据');
}

/**
 * 回导 town.json。同 id 的小镇会被整体替换，回导后可继续推进。
 * @returns {Promise<object>} 小镇记录
 */
export async function importTownJson(input) {
  const payload = parsePayload(input);
  validatePayload(payload);

  const town = { ...payload.town };
  assert(PACE_MODES.includes(town.pace_mode), '导入文件的小镇节奏不合法');
  assert(Number.isInteger(town.day_index) && town.day_index >= 0 && town.day_index <= LIMITS.DAYS_PER_TOWN, '导入文件的天数不合法');

  const tables = {};
  for (const name of TABLE_NAMES) {
    const rows = payload.tables[name] ?? [];
    assert(Array.isArray(rows), `导入文件的 ${name} 表必须是数组`);
    tables[name] = rows;
  }

  const existing = await db.get('town', town.id);
  if (existing) await dao.deleteTown(town.id);

  await db.put('town', town);
  try {
    for (const name of TABLE_NAMES) {
      for (const row of tables[name]) {
        const keyPath = STORES[name].keyPath;
        assert(row && typeof row === 'object' && row[keyPath] !== undefined, `${name} 表存在缺少主键的记录`);
        if (name === 'daily_report') {
          assert(
            REPORT_GENERATION_MODES.includes(row.generation_mode),
            `第 ${row.day} 天的小报生成模式不合法`
          );
        }
        await db.put(name, row);
      }
    }
  } catch (err) {
    await dao.deleteTown(town.id).catch(() => {});
    throw err;
  }

  return town;
}

/** 浏览器端下载文本文件 */
export function downloadText(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
