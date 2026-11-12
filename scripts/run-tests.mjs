/**
 * 测试入口包装器。
 * 让 `npm run test:unit -- --grep "xxx"` 这种写法可用：
 * vitest 本身用 -t，这里把 --grep 翻译成 -t。
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , suite, ...rest] = process.argv;

const SUITES = {
  unit: 'tests/unit',
  contract: 'tests/contract',
  integration: 'tests/integration',
};

const dir = SUITES[suite];
if (!dir) {
  console.error(`用法: node scripts/run-tests.mjs <${Object.keys(SUITES).join('|')}> [--grep 关键词]`);
  process.exit(1);
}

const passthrough = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--grep' || rest[i] === '-g') {
    passthrough.push('-t', rest[i + 1]);
    i += 1;
  } else {
    passthrough.push(rest[i]);
  }
}

const bin = join(root, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(bin)) {
  console.error('[test] 未找到 vitest，请先执行 npm install');
  process.exit(1);
}

const child = spawn(process.execPath, [bin, 'run', dir, ...passthrough], {
  cwd: root,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
