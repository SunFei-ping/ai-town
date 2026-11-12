import { ROUTE_LABELS } from '../routes.js';
import * as dao from '../../infra/storage/dao.js';
import { getCurrentTownId, clearCurrentTownId, setCurrentTownId } from '../../infra/storage/app-state.js';
import { runDay } from '../../domain/simulation/day.js';
import { createStubModel } from '../../infra/api/stub-model.js';
import { runTickFromServer } from '../../infra/api/tick-runner.js';
import { submitEvent } from '../../infra/api/events.js';
import { openSession, getSession, destroySession } from '../../infra/api/session.js';
import { createRelationGraph } from '../../ui/relationGraph.js';
import { createReportView } from '../../ui/report.js';
import { createEventComposer } from '../../ui/eventComposer.js';
import { createTownScene } from '../../ui/townScene.js';
import { exportShareImage } from '../../infra/share/index.js';
import {
  downloadText,
  exportTownJson,
  exportTownMarkdown,
  importTownJson,
} from '../../infra/storage/export.js';
import { computeBackfillPlan, runBackfill } from '../../domain/simulation/backfill.js';

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

  const eventSlot = el('div');
  const composer = createEventComposer({ onSubmit: saveEvent });
  eventSlot.append(composer.element);

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

  const backfillCard = el('div', 'card stack');
  backfillCard.hidden = true;
  backfillCard.dataset.component = 'backfill';
  const backfillText = el('p', 'muted');
  const backfillContinue = el('button', 'primary', '继续补算');
  backfillCard.append(el('h3', null, '真实时间补算'), backfillText, backfillContinue);

  const dataCard = el('div', 'card stack');
  dataCard.dataset.component = 'town-data';
  dataCard.append(el('h3', null, '小镇数据'));
  dataCard.append(
    el('p', 'muted', '导出后可以在任意设备回导继续推进；town.md 可以直接当故事读。')
  );
  const dataRow = el('div', 'row');
  const exportJsonBtn = el('button', null, '导出 town.json');
  const exportMdBtn = el('button', null, '导出 town.md');
  const importBtn = el('button', null, '导入 town.json');
  const importInput = el('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  const dataStatus = el('p', 'notice');
  dataStatus.hidden = true;
  dataRow.append(exportJsonBtn, exportMdBtn, importBtn);
  dataCard.append(dataRow, importInput, dataStatus);

  card.append(agentLine, progressList, controls);
  root.append(
    eyebrow,
    heading,
    intro,
    status,
    modelCard,
    eventSlot,
    sceneCard,
    card,
    backfillCard,
    dataCard,
    relationSlot,
    reportSlot,
    result
  );

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
  let advancing = false;

  function showDataStatus(message) {
    dataStatus.textContent = message;
    dataStatus.hidden = false;
  }

  /** M6-02：投递当天事件。有会话时先过服务端校验，再写本地。 */
  async function saveEvent({ type, payload }) {
    const day = town.day_index + 1;
    if (day > 7) throw new Error('这一周已经结束，不能再投递事件');

    const currentSession = getSession();
    let remote = null;
    if (currentSession) {
      remote = await submitEvent({
        townId,
        day,
        type,
        payload,
        sessionToken: currentSession.session_token,
      });
    }

    return dao.addEvent({
      town_id: townId,
      day,
      type,
      payload,
      source: 'user',
      created_at: remote?.created_at ?? Date.now(),
    });
  }

  exportJsonBtn.addEventListener('click', async () => {
    exportJsonBtn.disabled = true;
    try {
      const file = await exportTownJson(townId);
      downloadText(file.filename, file.content, 'application/json;charset=utf-8');
      showDataStatus(`已导出 ${file.filename}`);
    } catch (err) {
      showDataStatus(err.message ?? '导出失败');
    } finally {
      exportJsonBtn.disabled = false;
    }
  });

  exportMdBtn.addEventListener('click', async () => {
    exportMdBtn.disabled = true;
    try {
      const file = await exportTownMarkdown(townId);
      downloadText(file.filename, file.content, 'text/markdown;charset=utf-8');
      showDataStatus(`已导出 ${file.filename}`);
    } catch (err) {
      showDataStatus(err.message ?? '导出失败');
    } finally {
      exportMdBtn.disabled = false;
    }
  });

  importBtn.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    importBtn.disabled = true;
    try {
      const text = await file.text();
      const imported = await importTownJson(text);
      setCurrentTownId(imported.id);
      showDataStatus(`已导入 ${imported.name}，正在重新加载`);
      window.location.reload();
    } catch (err) {
      showDataStatus(err.message ?? '导入失败');
      importBtn.disabled = false;
    } finally {
      importInput.value = '';
    }
  });

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
    box.append(
      createReportView({
        report,
        townName: town?.name ?? '',
        onShare: (current) =>
          exportShareImage({ report: current, townName: town?.name ?? '' }),
      })
    );
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
    nextBtn.disabled = finished || advancing;
    nextBtn.textContent = finished ? '这一周结束了' : '过一天';
    if (finished) markStage('reporting');
    refreshSessionUI();
    renderRelations();

    const nextDay = town.day_index + 1;
    const nextEvents = nextDay <= 7 ? await dao.listEvents(townId, nextDay) : [];
    const submittedEvent = nextEvents.find((event) => event.source === 'user') ?? null;
    composer.update({
      day: finished ? null : nextDay,
      existing: submittedEvent,
      disabled: finished,
    });

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
    if (!town || nextBtn.disabled || advancing) return;
    advancing = true;
    nextBtn.disabled = true;
    status.hidden = true;
    resetProgress();

    if (agents.length !== 5) {
      showError('小镇必须恰好五个居民');
      nextBtn.disabled = false;
      advancing = false;
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
    } finally {
      advancing = false;
      if (town) nextBtn.disabled = town.day_index >= 7;
    }
  });

  /**
   * M6-05：真实时间模式回到页面时补算。
   * 单批最多 2 天，每天完成立即落盘并渲染；未补完的天数留到下次继续。
   */
  async function maybeBackfill() {
    if (advancing || !town || town.pace_mode !== 'realtime' || town.status !== 'running') return;
    const plan = computeBackfillPlan({ town });
    if (plan.unlocked <= 0) {
      backfillCard.hidden = true;
      return;
    }

    advancing = true;
    nextBtn.disabled = true;
    backfillCard.hidden = false;
    backfillText.textContent = `离开了一段时间，可补算 ${plan.unlocked} 天。本次最多补 ${plan.batch} 天，完成一天就先保存。`;

    try {
      const result = await runBackfill({
        town,
        advanceDay: async ({ town: current, day, lastTickAt }) => {
          const currentAgents = await dao.listAgents(townId);
          const currentSession = getSession();
          if (currentSession) {
            return runTickFromServer({
              town: current,
              agents: currentAgents,
              day,
              sessionToken: currentSession.session_token,
              generationMode: 'backfill',
              lastTickAt,
              onStage: markStage,
            });
          }
          return runDay({
            town: current,
            agents: currentAgents,
            day,
            model: createStubModel(),
            generationMode: 'backfill',
            lastTickAt,
            onStage: markStage,
          });
        },
        onWarning: (warning) => {
          backfillText.textContent = warning.message;
        },
        onDayDone: async (outcome) => {
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
        },
      });

      if (result.remaining > 0) {
        backfillCard.hidden = false;
        backfillText.textContent = `本次已补 ${result.completed} 天，还有 ${result.remaining} 天。可以继续补算，或下次打开时自动继续。`;
      } else {
        backfillCard.hidden = true;
      }
    } catch (err) {
      backfillCard.hidden = false;
      backfillText.textContent = `补算中断：${err.message ?? '未知错误'}。已完成的天已经保存，下次打开会继续。`;
    } finally {
      advancing = false;
      if (town) nextBtn.disabled = town.day_index >= 7;
    }
  }

  backfillContinue.addEventListener('click', () => {
    maybeBackfill();
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
      if (root.isConnected) maybeBackfill();
    } catch (err) {
      showError(err.message ?? '读取小镇失败');
    }
  })();
}
