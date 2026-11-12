import { ROUTE_LABELS } from '../routes.js';

export const title = ROUTE_LABELS.home;

export function render(root) {
  root.innerHTML = '';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'screen__eyebrow';
  eyebrow.textContent = '只能围观，不能指挥';

  const heading = document.createElement('h1');
  heading.textContent = ROUTE_LABELS.home;

  const intro = document.createElement('p');
  intro.textContent =
    '五个 AI 居民，七天，每天一份小报。你不玩它，你订阅它。';

  const actions = document.createElement('div');
  actions.className = 'row';

  const sampleBtn = document.createElement('button');
  sampleBtn.className = 'primary';
  sampleBtn.textContent = '看示例小镇';
  sampleBtn.addEventListener('click', () => {
    window.location.hash = '#/town';
  });

  const createBtn = document.createElement('button');
  createBtn.textContent = '建我的小镇';
  createBtn.addEventListener('click', () => {
    window.location.hash = '#/create';
  });

  actions.append(sampleBtn, createBtn);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = '示例小镇与建镇流程将在后续里程碑接通。';

  root.append(eyebrow, heading, intro, actions, note);
}
