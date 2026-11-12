/**
 * 小报生成，见 SPCD §8.3 的 reporting 阶段与 §6.2。
 * 固定四类版块 + 5 条 unsaid；生成模式支持 normal / backfill / degraded。
 */
import * as dao from '../../infra/storage/dao.js';
import { LABEL_TEXT } from '../relation/label.js';
import { createSection, createReportRecord } from './structure.js';

function agentNames(agents) {
  return new Map(agents.map((agent) => [agent.id, agent.name]));
}

/** 头条：优先写当天最具体的一次相遇 */
export function buildHeadline({ day, dialogues = [], names }) {
  const first = dialogues[0];
  if (first) {
    const [a, b] = first.participant_ids ?? [];
    return `第 ${day} 天：${first.location}，${names.get(a) ?? '有人'}和${names.get(b) ?? '另一个人'}说了几句`;
  }
  return `第 ${day} 天：没有人碰面，风从街口吹过去`;
}

/** 场景：把对话按时间排开；没有对话就写一句空白 */
export function buildSceneBody({ dialogues = [] }) {
  if (dialogues.length === 0) return '这一天没有人碰面。';
  return dialogues
    .map((dialogue) => {
      const lines = (dialogue.transcript ?? [])
        .map((round) => `${round.speaker}：${round.content}`)
        .join(' ');
      return `${String(dialogue.hour).padStart(2, '0')} 点，${dialogue.location}。${lines}`;
    })
    .join('\n');
}

/** 关系：至少写出 1 条当天发生的变化（§12.3 规则项） */
export function buildRelationBody({ names, previousRelations = [], relationUpdates = [] }) {
  const previousByPair = new Map(
    previousRelations.map((relation) => [
      `${relation.from_agent_id}|${relation.to_agent_id}`,
      relation,
    ])
  );

  const changes = [];
  for (const update of relationUpdates) {
    const previous = previousByPair.get(`${update.from_agent_id}|${update.to_agent_id}`);
    const before = previous?.affinity ?? 0;
    if (update.affinity === before) continue;
    changes.push({
      text: `${names.get(update.from_agent_id) ?? '有人'} → ${names.get(update.to_agent_id) ?? '另一个人'}：${LABEL_TEXT[update.label] ?? update.label}（${before} → ${update.affinity}）`,
    });
  }

  if (changes.length === 0) return '今天的关系没有变化。';
  return changes.map((change) => change.text).join('\n');
}

export function buildUnsaidBody({ unsays = [] }) {
  return `五个人今天都有一句话没说出来，一共 ${unsays.length} 句。`;
}

/**
 * 组装一份完整小报（不落库）。
 * unsays 需已由 ensureUnsays 保证 5 条。
 */
export function buildReport({
  town,
  day,
  agents,
  unsays = [],
  dialogues = [],
  previousRelations = [],
  relationUpdates = [],
  generationMode = 'normal',
  generatedAt,
}) {
  const names = agentNames(agents);
  const sections = [
    createSection('headline', buildHeadline({ day, dialogues, names })),
    createSection('scene', buildSceneBody({ dialogues })),
    createSection('relation', buildRelationBody({ names, previousRelations, relationUpdates })),
    createSection('unsaid', buildUnsaidBody({ unsays })),
  ];

  return createReportRecord({
    townId: town.id,
    day,
    headline: sections[0].body,
    generationMode,
    sections,
    unsays,
    generatedAt,
  });
}

/** 生成并落库；`(town_id, day)` 冲突时由 DAO 抛错 */
export async function generateReport(options) {
  const report = buildReport(options);
  return dao.saveReport(report);
}
