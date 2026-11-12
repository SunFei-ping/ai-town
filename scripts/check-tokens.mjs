/**
 * 校验设计令牌：
 * 1) tokens.css 必须包含全部必需的变量分组
 * 2) base.css 不得出现硬编码色值，只能引用变量
 * 3) base.css 必须提供 375 / 768 / 1280 三个断点
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = join(root, 'web/styles/tokens.css');
const basePath = join(root, 'web/styles/base.css');

const tokens = readFileSync(tokensPath, 'utf8');
const base = readFileSync(basePath, 'utf8');

const REQUIRED_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-ink',
  '--color-ink-soft',
  '--color-line',
  '--color-accent',
  '--font-display',
  '--font-body',
  '--font-mono',
  '--text-base',
  '--space-4',
  '--radius-md',
  '--shadow-1',
  '--shell-max',
];

const problems = [];

for (const name of REQUIRED_TOKENS) {
  if (!new RegExp(`${name}\\s*:`).test(tokens)) {
    problems.push(`tokens.css 缺少变量 ${name}`);
  }
}

const hexLike = /#[0-9a-fA-F]{3,8}\b/g;
const colorFn = /\b(?:rgb|rgba|hsl|hsla)\s*\(/g;

const hexHits = base.match(hexLike) ?? [];
const fnHits = base.match(colorFn) ?? [];

if (hexHits.length > 0) {
  problems.push(`base.css 出现硬编码十六进制色值：${[...new Set(hexHits)].join(', ')}`);
}
if (fnHits.length > 0) {
  problems.push(`base.css 出现硬编码颜色函数：${[...new Set(fnHits)].join(', ')}`);
}

for (const bp of ['375px', '768px', '1280px']) {
  if (!base.includes(bp)) problems.push(`base.css 缺少断点 ${bp}`);
}

if (problems.length > 0) {
  console.error('[tokens] 校验失败：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('[tokens] OK：令牌齐全，base.css 无硬编码色值，三个断点齐备');
