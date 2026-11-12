import { ROUTE_LABELS } from '../routes.js';
import { listTemplates, loadTemplate } from '../../infra/api/templates.js';
import * as dao from '../../infra/storage/dao.js';
import { setCurrentTownId } from '../../infra/storage/app-state.js';

export const title = ROUTE_LABELS.create;

const EDITABLE_FIELDS = [
  { key: 'name', label: '名字', type: 'input', max: 8 },
  { key: 'age', label: '年龄', type: 'number', max: 3 },
  { key: 'occupation', label: '职业', type: 'input', max: 20 },
  { key: 'persona', label: '人设', type: 'textarea', max: 300 },
  { key: 'secret', label: '秘密（不会写进对话，只影响行为）', type: 'textarea', max: 200 },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function render(root) {
  root.innerHTML = '';

  const eyebrow = el('p', 'screen__eyebrow', '第一步');
  const heading = el('h1', null, ROUTE_LABELS.create);
  const intro = el('p', null, '选一个模板，五个居民可以沿用也可以改。首版固定五人、七天。');

  const status = el('p', 'notice');
  status.hidden = true;

  const form = el('div', 'stack');
  const list = el('div');
  const startBtn = el('button', 'primary', '开始');
  startBtn.disabled = true;

  form.append(list, startBtn);
  root.append(eyebrow, heading, intro, status, form);

  const state = { template: null, agents: [], templateId: null, paceMode: 'quick' };

  function showError(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function collect() {
    return state.agents.map((agent) => ({
      ...agent,
      age: Number(agent.age),
    }));
  }

  function renderAgents() {
    list.innerHTML = '';

    const townField = el('div', 'field');
    const townLabel = el('label', null, '小镇名');
    const townInput = el('input', 'input');
    townInput.maxLength = 16;
    townInput.value = 'AI小镇';
    townField.append(townLabel, townInput);

    const selectField = el('div', 'field');
    const selectLabel = el('label', null, '模板');
    const select = el('select', 'select');

    for (const tpl of state.templates) {
      const option = el('option', null, tpl.name);
      option.value = tpl.id;
      option.selected = tpl.id === state.templateId;
      select.append(option);
    }
    selectField.append(selectLabel, select);

    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await applyTemplate(select.value, townInput.value);
      } catch (err) {
        showError(err.message ?? '模板切换失败');
      } finally {
        select.disabled = false;
      }
    });

    const paceField = el('div', 'field');
    const paceLabel = el('label', null, '节奏');
    const paceSelect = el('select', 'select');
    for (const [value, label] of [
      ['quick', '快进（每次点「过一天」推进一天）'],
      ['realtime', '真实时间（一个真实日等于一天，回来时自动补算）'],
    ]) {
      const option = el('option', null, label);
      option.value = value;
      option.selected = value === state.paceMode;
      paceSelect.append(option);
    }
    paceSelect.addEventListener('change', () => {
      state.paceMode = paceSelect.value;
    });
    paceField.append(paceLabel, paceSelect);

    list.append(townField, selectField, paceField);

    state.agents.forEach((agent, index) => {
      const card = el('div', 'agent-card');

      const head = el('div', 'agent-card__head');
      const indexTag = el('span', 'muted', `0${index + 1}`);
      const name = el('span', 'agent-card__name', agent.name);
      head.append(indexTag, name);

      const grid = el('div', 'grid-2');
      for (const field of EDITABLE_FIELDS) {
        const wrap = el('div', 'field');
        const label = el('label', null, field.label);
        const input = el(field.type === 'textarea' ? 'textarea' : 'input', field.type === 'textarea' ? 'textarea' : 'input');
        if (field.type === 'number') {
          input.type = 'number';
          input.min = '1';
          input.max = '120';
        } else {
          input.maxLength = field.max;
        }
        input.value = agent[field.key] ?? '';
        input.addEventListener('input', () => {
          agent[field.key] = field.type === 'number' ? Number(input.value) : input.value;
          if (field.key === 'name') name.textContent = input.value || '（未命名）';
        });
        wrap.append(label, input);
        grid.append(wrap);
      }

      card.append(head, grid);
      list.append(card);
    });

    state.townNameInput = townInput;
    startBtn.disabled = false;
  }

  async function applyTemplate(templateId, keepName) {
    const template = await loadTemplate(templateId);
    state.template = template;
    state.templateId = templateId;
    state.agents = template.agents.map((a) => ({ ...a }));
    renderAgents();
    if (keepName && state.townNameInput) state.townNameInput.value = keepName;
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    status.hidden = true;
    try {
      if (state.agents.length !== 5) {
        throw new Error('必须恰好五个居民');
      }
      const town = await dao.createTown(
        {
          name: state.townNameInput?.value?.trim() || 'AI小镇',
          templateId: state.templateId,
          paceMode: state.paceMode,
        },
        collect()
      );
      setCurrentTownId(town.id);
      window.location.hash = '#/town';
    } catch (err) {
      showError(err.message ?? '创建失败');
      startBtn.disabled = false;
    }
  });

  (async () => {
    try {
      state.templates = await listTemplates();
      if (!root.isConnected) return;
      const first = state.templates[0];
      if (!first) throw new Error('没有可用模板');
      await applyTemplate(first.id);
    } catch (err) {
      showError(err.message ?? '模板加载失败');
    }
  })();
}
