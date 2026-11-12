/**
 * 冒烟脚本。
 *
 * 本地模式：启动一个临时 dev server，验证静态页面、样式与运行时 KV 都可用。
 * 远端模式（--remote）：直接检查已部署环境的 /v1/health。
 *
 * 支持 --grep <关键词> 只跑某一组检查。
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const grepIndex = args.findIndex((a) => a === '--grep' || a === '-g');
const grep = grepIndex >= 0 ? args[grepIndex + 1] : null;

function matches(name) {
  return !grep || name.includes(grep);
}

async function checkLocal() {
  const port = 4174;
  const child = spawn(process.execPath, [join(root, 'scripts', 'dev-server.mjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server 启动超时')), 10000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('[dev] listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (buf) => process.stderr.write(buf));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server 提前退出，code=${code}`));
    });
  });

  const checks = [
    {
      name: 'static-index',
      async run() {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        const html = await res.text();
        if (res.status !== 200) throw new Error(`状态码 ${res.status}`);
        if (!html.includes('id="screen"')) throw new Error('首页缺少 #screen 容器');
        if (!html.includes('app/router.js')) throw new Error('首页未挂载路由脚本');
      },
    },
    {
      name: 'static-styles',
      async run() {
        for (const file of ['tokens.css', 'base.css']) {
          const res = await fetch(`http://127.0.0.1:${port}/styles/${file}`);
          if (res.status !== 200) throw new Error(`${file} 状态码 ${res.status}`);
        }
      },
    },
    {
      name: 'dev-runtime-kv',
      async run() {
        const res = await fetch(`http://127.0.0.1:${port}/_dev/runtime`);
        const data = await res.json();
        if (!data.ok) throw new Error('KV 读写未通过');
        if (!data.kv) throw new Error('KV 未就绪');
      },
    },
    {
      name: 'api-health',
      async run() {
        const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
        if (res.status === 404) {
          console.log('    · /v1/health 尚未实现（M1-04），跳过');
          return;
        }
        if (res.status !== 200) throw new Error(`状态码 ${res.status}`);
        const data = await res.json();
        if (data.ok !== true) throw new Error('health 未返回 ok=true');
        if (typeof data.version !== 'string') throw new Error('health 缺少 version');
      },
    },
    {
      name: 'api-session',
      async run() {
        const res = await fetch(`http://127.0.0.1:${port}/v1/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'sk-test-1234567890' }),
        });
        if (res.status === 404) {
          console.log('    · /v1/session 尚未实现（M1-04），跳过');
          return;
        }
        const data = await res.json();
        if (res.status !== 200) throw new Error(`状态码 ${res.status}`);
        if (!data.session_token) throw new Error('缺少 session_token');
        if (!data.expires_at) throw new Error('缺少 expires_at');
      },
    },
  ];

  try {
    await ready;
    let failed = 0;
    for (const check of checks.filter((c) => matches(c.name))) {
      try {
        await check.run();
        console.log(`  ✓ ${check.name}`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${check.name}：${err.message}`);
      }
    }
    if (failed > 0) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

async function checkRemote() {
  const base = process.env.BASE_URL;
  if (!base) {
    console.error('remote 模式需要设置 BASE_URL');
    process.exit(1);
  }
  const res = await fetch(new URL('/v1/health', base));
  if (res.status !== 200) {
    console.error(`  ✗ remote-health：状态码 ${res.status}`);
    process.exit(1);
  }
  console.log('  ✓ remote-health');
}

console.log(isRemote ? '[smoke] remote' : '[smoke] local');
await (isRemote ? checkRemote() : checkLocal());
if (process.exitCode !== 1) console.log('[smoke] 通过');
