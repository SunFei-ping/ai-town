/**
 * 分享长图，见 task.md M6-03 与 SPCD ADR-008。
 *
 * 纯前端 Canvas 出图：
 * - 只用系统字体，不加载任何跨域资源
 * - 不请求服务端出图端点，剧情数据不出浏览器
 * - 输出 PNG，包含小镇名、日期与当天小报正文
 */
export const SHARE_WIDTH = 750;
export const SHARE_PADDING = 56;

const BODY_FONT =
  'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const DISPLAY_FONT = '"Songti SC", "SimSun", "Noto Serif SC", serif';

const COLORS = Object.freeze({
  bg: '#f4efe5',
  surface: '#ffffff',
  ink: '#23262b',
  soft: '#565b63',
  faint: '#8b8f96',
  line: '#e2dbcd',
  accent: '#2f647c',
});

const CONTENT_WIDTH = SHARE_WIDTH - SHARE_PADDING * 2;

function dateText(date = new Date()) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function measureLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (!paragraph.trim()) continue;
    let line = '';
    for (const char of paragraph) {
      const candidate = line + char;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function buildItems({ report, townName, date }) {
  const items = [];
  const push = (text, { font, lineHeight, color, gap = 0 }) => {
    if (!text) return;
    items.push({ text: String(text), font, lineHeight, color, gap });
  };

  push(townName || 'AI小镇', {
    font: `700 42px ${DISPLAY_FONT}`,
    lineHeight: 56,
    color: COLORS.ink,
  });
  push(`第 ${report.day} 天 · ${dateText(date)}`, {
    font: `400 22px ${BODY_FONT}`,
    lineHeight: 32,
    color: COLORS.faint,
    gap: 6,
  });
  push(report.headline, {
    font: `700 31px ${DISPLAY_FONT}`,
    lineHeight: 45,
    color: COLORS.ink,
    gap: 26,
  });

  const sections = [...(report.sections ?? [])]
    .filter((section) => section.kind !== 'unsaid')
    .sort((a, b) => a.order - b.order);
  for (const section of sections) {
    push(section.title, {
      font: `600 22px ${BODY_FONT}`,
      lineHeight: 32,
      color: COLORS.accent,
      gap: 28,
    });
    push(section.body, {
      font: `400 21px ${BODY_FONT}`,
      lineHeight: 36,
      color: COLORS.soft,
      gap: 8,
    });
  }

  const unsays = report.unsays ?? [];
  if (unsays.length > 0) {
    push('没说出口的话', {
      font: `600 22px ${BODY_FONT}`,
      lineHeight: 32,
      color: COLORS.accent,
      gap: 30,
    });
    for (const unsay of unsays) {
      push(`${unsay.agent_name ?? '居民'}：${unsay.text}`, {
        font: `400 21px ${BODY_FONT}`,
        lineHeight: 36,
        color: COLORS.soft,
        gap: 8,
      });
    }
  }

  push('本故事由 AI 虚构生成', {
    font: `400 18px ${BODY_FONT}`,
    lineHeight: 28,
    color: COLORS.faint,
    gap: 34,
  });

  return items;
}

function measure(items, ctx) {
  let height = SHARE_PADDING * 2;
  for (const item of items) {
    ctx.font = item.font;
    const lines = measureLines(ctx, item.text, CONTENT_WIDTH);
    item.lines = lines;
    height += item.gap + lines.length * item.lineHeight;
  }
  return Math.ceil(height);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * 生成分享长图 canvas。纯函数式，便于测试与预览。
 * @param {{ report: object, townName?: string, date?: Date }} options
 */
export function renderShareCanvas({ report, townName = '', date = new Date() }) {
  if (typeof document === 'undefined') {
    throw new Error('分享长图只能在浏览器中生成');
  }
  if (!report || !Array.isArray(report.sections)) {
    throw new Error('缺少可分享的小报');
  }

  const probe = document.createElement('canvas');
  probe.width = SHARE_WIDTH;
  probe.height = 16;
  const probeCtx = probe.getContext('2d');
  const items = buildItems({ report, townName, date });
  const height = measure(items, probeCtx);

  const canvas = document.createElement('canvas');
  canvas.width = SHARE_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, SHARE_WIDTH, height);
  ctx.fillStyle = COLORS.surface;
  roundedRect(ctx, 24, 24, SHARE_WIDTH - 48, height - 48, 24);
  ctx.fill();

  ctx.textBaseline = 'top';
  let y = SHARE_PADDING;
  for (const item of items) {
    y += item.gap;
    ctx.font = item.font;
    ctx.fillStyle = item.color;
    for (const line of item.lines) {
      ctx.fillText(line, SHARE_PADDING, y);
      y += item.lineHeight;
    }
  }

  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前浏览器不支持导出 PNG'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('生成 PNG 失败'));
    }, 'image/png');
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 生成并下载分享长图。
 * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob, filename: string}>}
 */
export async function exportShareImage({ report, townName = '', date = new Date() } = {}) {
  const canvas = renderShareCanvas({ report, townName, date });
  const blob = await canvasToBlob(canvas);
  const filename = `ai-town-day-${report.day}.png`;
  triggerDownload(blob, filename);
  return { canvas, blob, filename };
}
