/**
 * 小报渲染，见 SPCD §6.2。
 * 固定版式：报头（小镇名 + 天数 + 生成模式）→ 四类版块 → 5 条 unsaid。
 */
const MODE_LABELS = Object.freeze({
  normal: '',
  backfill: '补算生成',
  degraded: '兜底生成',
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paragraphs(body) {
  return String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => el('p', 'report__text', line));
}

function renderUnsays(list, unsays) {
  const wrap = el('div', 'report__unsays');
  for (const unsay of unsays) {
    const item = el('div', 'report__unsay');
    item.dataset.agentId = unsay.agent_id;
    item.append(
      el('span', 'report__unsay-name', unsay.agent_name ?? '居民'),
      el('p', 'report__unsay-text', unsay.text)
    );
    wrap.append(item);
  }
  list.append(wrap);
}

/**
 * @param {{ report: object, townName?: string }} options
 * @returns {HTMLElement}
 */
export function createReportView({ report, townName = '' }) {
  const article = el('article', 'report');
  article.dataset.day = String(report.day);

  const masthead = el('header', 'report__masthead');
  const kicker = el(
    'p',
    'report__kicker',
    `${townName ? `${townName} · ` : ''}第 ${report.day} 天`
  );
  masthead.append(kicker, el('h2', 'report__headline', report.headline));

  const modeLabel = MODE_LABELS[report.generation_mode];
  if (modeLabel) {
    const badge = el('span', 'report__mode', modeLabel);
    badge.dataset.mode = report.generation_mode;
    masthead.append(badge);
  }
  article.append(masthead);

  const sections = [...(report.sections ?? [])].sort((a, b) => a.order - b.order);
  for (const section of sections) {
    const block = el('section', 'report__section');
    block.dataset.kind = section.kind;
    block.append(el('h3', 'report__section-title', section.title));
    for (const paragraph of paragraphs(section.body)) block.append(paragraph);
    if (section.kind === 'unsaid') renderUnsays(block, report.unsays ?? []);
    article.append(block);
  }

  return article;
}
