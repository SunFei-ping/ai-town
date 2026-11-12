import { ROUTE_LABELS } from '../routes.js';
import * as dao from '../../infra/storage/dao.js';
import { getCurrentTownId, clearCurrentTownId } from '../../infra/storage/app-state.js';
import { runDay } from '../../domain/simulation/day.js';
import { createStubModel } from '../../infra/api/stub-model.js';
import { runTickFromServer } from '../../infra/api/tick-runner.js';
import { openSession, getSession, destroySession } from '../../infra/api/session.js';
import { createRelationGraph } from '../../ui/relationGraph.js';
import { createReportView } from '../../ui/report.js';
import { createTownScene } from '../../ui/townScene.js';

export const title = ROUTE_LABELS.town;

const STAGE_LABELS = {
  validating: '校验',
  planning: '计划',
  simulating: '行动',
  reflecting: '独白',
  reporting: '成稿',
};

let activeScene = null;

export function destroy() {
  activeScene?.destroy();
  activeScene = null;
}

function parsePlan(planJson) {
  try {
    const plan = JSON.parse(planJson ?? '[]');
    return Array.isArray(plan) ? plan : [];
  } catch {
    return [];
  }
}

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

  const modelCard = el('div', 'card stack');
  const modelTitle = el('h3', null, '模型连接');
  const modelHint = el(
    'p',
    'muted',
    '粘贴 API Key 后使用真实模型推进；不连接时使用本地桩模型，不消耗额度。Key 只用于换取两小时会话，不会写进本地存储。'
  );
  const keyField = el('div', 'field');
  const keyLabel = el('label', null, 'API Key');
  const keyInput = el('input', 'input');
  keyInput.type = 'password';
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyField.append(keyLabel, keyInput);

  const sessionRow = el('div', 'row');
  const connectBtn = el('button', null, '连接模型');
  const disconnectBtn = el('button', null, '断开');
  disconnectBtn.hidden = true;
  sessionRow.append(connectBtn, disconnectBtn);
  const modelStatus = el('p', 'muted', '当前：桩模型（不消耗 API 额度）');
  modelCard.append(modelTitle, modelHint, keyField, sessionRow, modelStatus);

  const sceneCard = el('div', 'card stack town-scene-card');
  const sceneHead = el('div', 'row');
  const sceneTitle = el('h3', null, '小镇');
  const replayBtn = el('button', null, '重播');
  replayBtn.hidden = true;
  sceneHead.append(sceneTitle, replayBtn);
  const sceneContainer = el('div', 'town-scene');
  sceneContainer.dataset.scene = 'town';
  const sceneChips = el('div', 'town-scene__chips');
  sceneCard.append(sceneHead, sceneContainer, sceneChips);

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
  const reportSlot = el('div');

  card.append(agentLine, progressList, controls);
  root.append(eyebrow, heading, intro, status, modelCard, sceneCard, card, relationSlot, reportSlot, result);

  let scene = null;
  const sceneChipsById = new Map();
  function syncSceneChips(selection) {
    for (const [id, chip] of sceneChipsById) {
      chip.setAttribute(
        'aria-pressed',
        selection?.type === 'agent' && selection.id === id ? 'true' : 'false'
      );
    }
  }
  try {
    scene = createTownScene({
      container: sceneContainer,
      onSelect: syncSceneChips,
    });
    activeScene = scene;
  } catch (err) {
    sceneContainer.innerHTML = '';
    const fallback = el('div', 'town-scene__fallback', `3D 场景加载失败：${err.message ?? '未知错误'}`);
    sceneContainer.append(fallback);
  }

  let sceneData = null;
  function setSceneData(data, { play = false } = {}) {
    sceneData = data;
    sceneChips.replaceChildren();
    sceneChipsById.clear();
    for (const agent of data.agents ?? []) {
      const chip = el('button', 'town-scene__chip', agent.name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => scene?.selectAgent(agent.id));
      sceneChips.append(chip);
      sceneChipsById.set(agent.id, chip);
    }
    sceneChips.hidden = sceneChipsById.size === 0;
    if (play) scene?.playDay(data);
    else scene?.showStatic(data);
    replayBtn.hidden = !(data.plans ?? []).some((entry) => (entry.plan?.length ?? 0) > 0);
  }

  replayBtn.addEventListener('click', () => {
    if (sceneData) scene?.playDay(sceneData);
  });

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
  let session = getSession();

  function refreshSessionUI() {
    session = getSession();
    const connected = Boolean(session);
    connectBtn.textContent = connected ? '重新连接' : '连接模型';
    disconnectBtn.hidden = !connected;
    modelStatus.textContent = connected
      ? `当前：真实模型（会话有效至 ${new Date(session.expires_at).toLocaleTimeString('zh-CN', {
          hour12: false,
        })}）`
      : '当前：桩模型（不消耗 API 额度）';
  }

  connectBtn.addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      showError('请先粘贴 API Key');
      return;
    }
    connectBtn.disabled = true;
    status.hidden = true;
    try {
      await openSession(apiKey);
      keyInput.value = '';
      refreshSessionUI();
    } catch (err) {
      showError(err.message ?? 'Key 校验失败');
    } finally {
      connectBtn.disabled = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    disconnectBtn.disabled = true;
    try {
      await destroySession();
      status.hidden = true;
      refreshSessionUI();
    } finally {
      disconnectBtn.disabled = false;
    }
  });

  refreshSessionUI();

  function renderRelations() {
    relationSlot.innerHTML = '';
    const box = el('div', 'card stack');
    box.append(el('h3', null, '关系'));
    box.append(createRelationGraph({ agents, relations }));
    relationSlot.append(box);
  }

  function renderReport(report) {
    reportSlot.innerHTML = '';
    if (!report) return;
    const box = el('div', 'card stack');
    box.append(el('h3', null, '今日小报'));
    box.append(createReportView({ report, townName: town?.name ?? '' }));
    reportSlot.append(box);
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
    refreshSessionUI();
    renderRelations();

    const plans = agents.map((agent) => ({
      agent_id: agent.id,
      agent_name: agent.name,
      plan: parsePlan(agent.plan_json),
    }));
    const dialogues =
      town.day_index >= 1 ? await dao.listDialogues(townId, town.day_index) : [];
    if (root.isConnected) {
      setSceneData({ agents, plans, dialogues, day: town.day_index }, { play: false });
    }

    const latest = town.day_index >= 1 ? await dao.getReport(townId, town.day_index) : null;
    if (root.isConnected) renderReport(latest);
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

    const currentSession = getSession();
    try {
      const outcome = currentSession
        ? await runTickFromServer({
            town,
            agents,
            day: town.day_index + 1,
            sessionToken: currentSession.session_token,
            onStage: markStage,
          })
        : await runDay({
            town,
            agents,
            day: town.day_index + 1,
            model: createStubModel(),
            onStage: markStage,
          });

      renderOutcome(outcome);
      await refresh();
      if (root.isConnected) {
        setSceneData(
          {
            agents,
            plans: outcome.plans,
            dialogues: outcome.dialogues,
            day: outcome.town.day_index,
          },
          { play: true }
        );
      }
    } catch (err) {
      if (err.code === 'E_NO_SESSION') {
        await destroySession();
        refreshSessionUI();
        showError('会话已失效，请重新连接模型');
      } else {
        showError(err.message ?? '推进失败');
      }
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
