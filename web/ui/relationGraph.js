/**
 * 关系图最小可视化：5 个节点 + 有向关系边。
 * 三态可辨（熟 / 生 / 有结），每个节点与边都带可读文本替代。
 */
import { LABEL_STATE, LABEL_TEXT } from '../domain/relation/label.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADIUS = 22;
const CENTER = { x: 160, y: 126 };
const ORBIT = 92;

const LEGEND = [
  { state: 'familiar', text: LABEL_TEXT.familiar },
  { state: 'stranger', text: LABEL_TEXT.stranger },
  { state: 'knot', text: LABEL_TEXT.knot },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function nodePosition(index, count) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: CENTER.x + ORBIT * Math.cos(angle),
    y: CENTER.y + ORBIT * Math.sin(angle),
  };
}

function edgePath(from, to, side) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = { x: from.x + ux * (NODE_RADIUS + 2), y: from.y + uy * (NODE_RADIUS + 2) };
  const end = { x: to.x - ux * (NODE_RADIUS + 7), y: to.y - uy * (NODE_RADIUS + 7) };
  const bend = 16 * side;
  const cx = (start.x + end.x) / 2 - uy * bend;
  const cy = (start.y + end.y) / 2 + ux * bend;
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
}

function buildMarkers(svg) {
  const defs = svgEl('defs');
  for (const state of new Set(Object.values(LABEL_STATE))) {
    const marker = svgEl('marker', {
      id: `relation-arrow-${state}`,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: 'auto-start-reverse',
    });
    const arrow = svgEl('path', {
      d: 'M 0 0 L 10 5 L 0 10 z',
      class: 'relation-graph__arrow',
      'data-label': state,
    });
    marker.append(arrow);
    defs.append(marker);
  }
  svg.append(defs);
}

function buildLegend() {
  const list = el('ul', 'relation-graph__legend');
  for (const item of LEGEND) {
    const node = el('li', 'relation-graph__legend-item', item.text);
    node.dataset.state = item.state;
    list.append(node);
  }
  return list;
}

/**
 * @returns {HTMLElement} figure 元素，可直接挂到页面上
 */
export function createRelationGraph({ agents, relations = [] }) {
  const figure = el('figure', 'relation-graph');
  const svg = svgEl('svg', {
    class: 'relation-graph__canvas',
    viewBox: '0 0 320 280',
    role: 'group',
    'aria-label': '小镇关系图',
  });
  buildMarkers(svg);

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const positions = new Map();
  agents.forEach((agent, index) => positions.set(agent.id, nodePosition(index, agents.length)));

  for (const relation of relations) {
    const from = positions.get(relation.from_agent_id);
    const to = positions.get(relation.to_agent_id);
    const fromAgent = byId.get(relation.from_agent_id);
    const toAgent = byId.get(relation.to_agent_id);
    if (!from || !to || !fromAgent || !toAgent) continue;

    const labelState = LABEL_STATE[relation.label] ?? 'stranger';
    const side = relation.from_agent_id < relation.to_agent_id ? 1 : -1;
    const path = svgEl('path', {
      d: edgePath(from, to, side),
      class: 'relation-graph__edge',
      'data-label': relation.label ?? 'stranger',
      'marker-end': `url(#relation-arrow-${labelState})`,
    });
    const title = svgEl('title');
    title.textContent = `${fromAgent.name} → ${toAgent.name}：${LABEL_TEXT[relation.label] ?? '生'}（${relation.affinity}）`;
    path.append(title);
    svg.append(path);
  }

  for (const agent of agents) {
    const point = positions.get(agent.id);
    const group = svgEl('g', {
      class: 'relation-graph__node',
      role: 'img',
      'aria-label': `${agent.name}，${agent.occupation ?? '居民'}`,
    });
    const circle = svgEl('circle', { cx: point.x, cy: point.y, r: NODE_RADIUS });
    const text = svgEl('text', { x: point.x, y: point.y });
    const name = agent.name ?? '';
    text.textContent = name;
    if (name.length > 3) {
      text.setAttribute('textLength', '36');
      text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    const title = svgEl('title');
    title.textContent = `${name}，${agent.occupation ?? '居民'}`;
    group.append(title, circle, text);
    svg.append(group);
  }

  const edgeList = el('ul', 'relation-graph__edges');
  if (relations.length === 0) {
    edgeList.append(el('li', 'muted', '还没有形成关系。'));
  } else {
    for (const relation of relations) {
      const from = byId.get(relation.from_agent_id);
      const to = byId.get(relation.to_agent_id);
      if (!from || !to) continue;
      const item = el(
        'li',
        null,
        `${from.name} → ${to.name}：${LABEL_TEXT[relation.label] ?? '生'}（${relation.affinity}）`
      );
      item.dataset.label = relation.label ?? 'stranger';
      edgeList.append(item);
    }
  }

  figure.append(svg, buildLegend(), edgeList);
  return figure;
}
