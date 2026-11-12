/**
 * 校验目录结构是否与 docs/spcd.md §5 一致。
 * 任何模块目录被误删或改名，这里会先报错。
 */
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_DIRS = [
  'web',
  'web/styles',
  'web/app',
  'web/app/screens',
  'web/domain',
  'web/domain/town',
  'web/domain/agent',
  'web/domain/memory',
  'web/domain/relation',
  'web/domain/simulation',
  'web/domain/report',
  'web/infra',
  'web/infra/session',
  'web/infra/api',
  'web/infra/storage',
  'web/infra/share',
  'web/ui',
  'functions',
  'functions/health',
  'functions/session',
  'functions/templates',
  'functions/events',
  'functions/tick',
  'functions/model',
  'functions/runtime',
  'functions/guard',
  'shared',
  'shared/contracts',
  'shared/errors',
  'data',
  'data/templates',
  'data/sample-town',
  'scripts',
  'tests',
  'tests/unit',
  'tests/contract',
  'tests/integration',
  'tests/e2e',
];

const REQUIRED_FILES = [
  'package.json',
  'web/index.html',
  'web/styles/tokens.css',
  'web/styles/base.css',
  'web/app/router.js',
  'web/app/routes.js',
  'web/app/screens/home.js',
  'web/app/screens/create.js',
  'web/app/screens/town.js',
  'web/app/screens/year.js',
  'shared/contracts/index.js',
  'shared/errors/codes.js',
  'scripts/dev-server.mjs',
  'scripts/smoke.mjs',
  'scripts/check-structure.mjs',
  'scripts/check-tokens.mjs',
  'docs/spcd.md',
  'docs/task.md',
];

const missing = [];

for (const rel of REQUIRED_DIRS) {
  const abs = join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) missing.push(`${rel}/`);
}
for (const rel of REQUIRED_FILES) {
  const abs = join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) missing.push(rel);
}

if (missing.length > 0) {
  console.error('[structure] 缺失以下路径：');
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(
  `[structure] OK：${REQUIRED_DIRS.length} 个目录、${REQUIRED_FILES.length} 个文件齐全`
);
