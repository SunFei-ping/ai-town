import { ROUTE_LABELS } from '../routes.js';
import { loadSampleTown } from '../../infra/api/sample-town.js';
import { createReportView } from '../../ui/report.js';
import { exportShareImage } from '../../infra/share/index.js';

export const title = ROUTE_LABELS.home;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSampleTown(container) {
  const box = el('div', 'card stack sample-town');

  const loading = el('p', 'muted', '正在读取示例小镇……');
  box.append(loading);
  container.append(box);

  loadSampleTown()
    .then(({ town, agents, reports, summary }) => {
      box.innerHTML = '';

      box.append(el('p', 'screen__eyebrow', '示例小镇 · 零成本围观'));
      box.append(el('h2', null, town.name));
      if (summary) box.append(el('p', 'muted', summary));
      box.append(el('p', 'muted', agents.map((agent) => `${agent.name}（${agent.occupation}）`).join(' · ')));

      const tabs = el('div', 'row sample-town__days');
      const view = el('div', 'sample-town__report');
      const buttons = new Map();

      const show = (report) => {
        view.innerHTML = '';
        view.append(
          createReportView({
            report,
            townName: town.name,
            onShare: (current) => exportShareImage({ report: current, townName: town.name }),
          })
        );
        for (const [day, button] of buttons) {
          button.setAttribute('aria-pressed', String(day === report.day));
        }
      };

      for (const report of reports) {
        const button = el('button', 'sample-town__day', `第 ${report.day} 天`);
        button.dataset.day = String(report.day);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => show(report));
        buttons.set(report.day, button);
        tabs.append(button);
      }

      box.append(tabs, view);
      if (reports.length > 0) show(reports[0]);
    })
    .catch((err) => {
      box.innerHTML = '';
      box.append(el('p', 'muted', err.message ?? '示例小镇加载失败'));
    });
}

export function render(root) {
  root.innerHTML = '';

  const eyebrow = el('p', 'screen__eyebrow', '只能围观，不能指挥');
  const heading = el('h1', null, ROUTE_LABELS.home);
  const intro = el(
    'p',
    null,
    '五个 AI 居民，七天，每天一份小报。你不玩它，你订阅它。'
  );

  const actions = el('div', 'row');

  const sampleBtn = el('button', 'primary', '看示例小镇');
  sampleBtn.addEventListener('click', () => {
    document.getElementById('sample-town')?.scrollIntoView({ behavior: 'smooth' });
  });

  const createBtn = el('button', null, '建我的小镇');
  createBtn.addEventListener('click', () => {
    window.location.hash = '#/create';
  });

  actions.append(sampleBtn, createBtn);

  const sampleSlot = el('div');
  sampleSlot.id = 'sample-town';

  root.append(eyebrow, heading, intro, actions, sampleSlot);

  renderSampleTown(sampleSlot);
}
