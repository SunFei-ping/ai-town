import { ROUTE_LABELS } from '../routes.js';

export const title = ROUTE_LABELS.year;

export function render(root) {
  root.innerHTML = '';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'screen__eyebrow';
  eyebrow.textContent = '七天之后';

  const heading = document.createElement('h1');
  heading.textContent = ROUTE_LABELS.year;

  const intro = document.createElement('p');
  intro.textContent = '一周的关系变化、隐藏剧情与每个人的结局。';

  const card = document.createElement('div');
  card.className = 'card';

  const placeholder = document.createElement('p');
  placeholder.className = 'muted';
  placeholder.textContent = '年报将在 M4 之后生成。';

  card.append(placeholder);
  root.append(eyebrow, heading, intro, card);
}
