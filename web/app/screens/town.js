import { ROUTE_LABELS } from '../routes.js';
import * as dao from '../../infra/storage/dao.js';
import { getCurrentTownId, clearCurrentTownId } from '../../infra/storage/app-state.js';
import { runDay } from '../../domain/simulation/day.js';
import { createStubModel } from '../../infra/api/stub-model.js';
import { createRelationGraph } from '../../ui/relationGraph.js';

export const title = ROUTE_LABELS.town;

const STAGE_LABELS = {
  validating: '校验',
  planning: '计划',
  simulating: '行动',
  reflecting: '独白',
  reporting: '成稿',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildProgress() {
  const list = el('ul', 'progress');
  const items = new Map();
  for (const [stage, label] of Object.entries(STAGE_LABELS)) {
    const item = el('li', 'progress__item', label);
    item.dataset.stage = stage;
    items.set(stage, item);
    list.append(item);
  }
  return { list, items };
}

export function render(root) {
  root.innerHTML = '';

  const townId = getCurrentTownId();
  if (!townId) {
    const empty = el('div', 'empty');
    const text = el('p', null, '还没有小镇。先去建一座。');
    const go = el('button', 'primary', '去建镇');
    go.addEventListener('click', () => {
      window.location.hash = '#/create';
    });
    empty.append(text, go);
    root.append(el('h1', null, ROUTE_LABELS.town), empty);
    return;
  }

  const eyebrow = el('p', 'screen__eyebrow', '第 0 天');
  const heading = el('h1', null, ROUTE_LABELS.town);
  const intro = el('p', null, '推进一天，看看今天发生了什么。');

  const status = el('p', 'notice');
  status.hidden = true;

  const { list: progressList, items: progressItems } = buildProgress();

  const card = el('div', 'card stack');
  const agentLine = el('p', 'muted');
  const controls = el('div', 'row');
  const nextBtn = el('button', 'primary', '过一天');
  nextBtn.disabled = true;
  const resetBtn = el('button', null, '清空本地数据');
  controls.append(nextBtn, resetBtn);

  const result = el('div');
  const relationSlot = el('div');

  card.append(agentLine, progressList, controls);
  root.append(eyebrow, heading, intro, status, card, relationSlot, result);

  function showError(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function resetProgress() {
    for (const item of progressItems.values()) item.dataset.state = '';
  }

  function markStage(stage) {
    let reached = false;
    for (const [name, item] of progressItems.entries()) {
      if (name === stage) {
        item.dataset.state = 'active';
        reached = true;
      } else if (!reached) {
        item.dataset.state = 'done';
      } else {
        item.dataset.state = '';
      }
    }
  }

  let town = null;
  let agents = [];
  let relations = [];

  function renderRelations() {
    relationSlot.innerHTML = '';
    const box = el('div', 'card stack');
    box.append(el('h3', null, '关系'));
    box.append(createRelationGraph({ agents, relations }));
    relationSlot.append(box);
  }

  function renderOutcome(outcome) {
    result.innerHTML = '';
    const box = el('div', 'card stack');
    box.append(el('h3', null, `今日计划 · 第 ${outcome.town.day_index} 天`));

    const groups = el('div', 'stack');
    for (const entry of outcome.plans) {
      const block = el('div', 'agent-plan');
      block.append(
        el('p', 'agent-plan__name', `${entry.agent_name}${entry.degraded ? '（模板计划）' : ''}`)
      );
      const list = el('ul', 'plan-list');
      for (const item of entry.plan) {
        list.append(
          el('li', null, `${String(item.hour).padStart(2, '0')}:00 ${item.location} — ${item.intent}`)
        );
      }
      block.append(list);

      const unsay = outcome.unsays.find((item) => item.agent_id === entry.agent_id);
      if (unsay) block.append(el('p', 'quote', unsay.text));
      groups.append(block);
    }
    box.append(groups);

    if (outcome.warnings.length > 0) {
      box.append(
        el('p', 'notice', `有 ${outcome.warnings.length} 处生成失败，已用降级结果继续。`)
      );
    }
    if (outcome.dayStatus === 'partial') {
      box.append(el('p', 'notice', '这一天生成得不完整，但已经记下了。'));
    }

    result.append(box);
  }

  async function refresh() {
    town = await dao.getTown(townId);
    agents = await dao.listAgents(townId);
    relations = await dao.listRelations(townId);
    eyebrow.textContent = `第 ${town.day_index} 天`;
    agentLine.textContent = agents.map((a) => `${a.name}（${a.occupation}）`).join(' · ');
    const finished = town.day_index >= 7;
    nextBtn.disabled = finished;
    nextBtn.textContent = finished ? '这一周结束了' : '过一天';
    if (finished) markStage('reporting');
    renderRelations();
  }

  nextBtn.addEventListener('click', async () => {
    if (!town || nextBtn.disabled) return;
    nextBtn.disabled = true;
    status.hidden = true;
    resetProgress();

    if (agents.length !== 5) {
      showError('小镇必须恰好五个居民');
      nextBtn.disabled = false;
      return;
    }

    try {
      const outcome = await runDay({
        town,
        agents,
        day: town.day_index + 1,
        model: createStubModel(),
        onStage: markStage,
      });

      renderOutcome(outcome);
      await refresh();
    } catch (err) {
      showError(err.message ?? '推进失败');
      nextBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', async () => {
    try {
      await dao.deleteTown(townId);
    } finally {
      clearCurrentTownId();
      window.location.hash = '#/create';
    }
  });

  (async () => {
    try {
      await refresh();
      if (root.isConnected) nextBtn.disabled = town.day_index >= 7;
    } catch (err) {
      showError(err.message ?? '读取小镇失败');
    }
  })();
}
