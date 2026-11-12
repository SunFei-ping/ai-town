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
import { SCHEMA_VERSION, isSchemaCompatible } from '../shared/contracts/index.js';

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
    // 本地冒烟固定使用桩模型，避免开发机上的真实模型配置影响结果
    env: { ...process.env, PORT: String(port), MODEL_MODE: 'stub' },
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
    {
      name: 'api-templates',
      async run() {
        const listRes = await fetch(`http://127.0.0.1:${port}/v1/templates`);
        if (listRes.status === 404) {
          console.log('    · /v1/templates 尚未实现，跳过');
          return;
        }
        if (listRes.status !== 200) throw new Error(`列表状态码 ${listRes.status}`);
        const list = await listRes.json();
        if (!Array.isArray(list.templates) || list.templates.length !== 3) {
          throw new Error('模板列表不是三套');
        }
        for (const meta of list.templates) {
          const detailRes = await fetch(`http://127.0.0.1:${port}/v1/templates/${meta.id}`);
          if (detailRes.status !== 200) throw new Error(`${meta.id} 状态码 ${detailRes.status}`);
          const detail = await detailRes.json();
          if (detail.template?.agents?.length !== 5) {
            throw new Error(`${meta.id} 模板居民不是 5 人`);
          }
        }
        const missing = await fetch(`http://127.0.0.1:${port}/v1/templates/not-exist`);
        if (missing.status !== 400) throw new Error(`未知模板状态码 ${missing.status}`);
      },
    },
    {
      name: 'session-live',
      async run() {
        const startedAt = Date.now();
        const valid = await fetch(`http://127.0.0.1:${port}/v1/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'sk-smoke-1234567890' }),
        });
        const data = await valid.json();
        if (valid.status !== 200) throw new Error(`有效 Key 状态码 ${valid.status}`);
        if (!data.session_token) throw new Error('缺少 session_token');
        const ttl = data.expires_at - startedAt;
        if (ttl < 2 * 60 * 60 * 1000 - 5000 || ttl > 2 * 60 * 60 * 1000 + 5000) {
          throw new Error(`会话 TTL 不是 2 小时：${ttl}`);
        }

        const invalid = await fetch(`http://127.0.0.1:${port}/v1/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'invalid-key-000000' }),
        });
        const invalidBody = await invalid.json();
        if (invalid.status !== 401) throw new Error(`无效 Key 状态码 ${invalid.status}`);
        if (invalidBody.error?.code !== 'E_KEY_INVALID') {
          throw new Error(`无效 Key 错误码 ${invalidBody.error?.code}`);
        }

        const destroyed = await fetch(`http://127.0.0.1:${port}/v1/session`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${data.session_token}` },
        });
        if (destroyed.status !== 204) throw new Error(`销毁会话状态码 ${destroyed.status}`);

        const again = await fetch(`http://127.0.0.1:${port}/v1/session`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${data.session_token}` },
        });
        const againBody = await again.json();
        if (again.status !== 401 || againBody.error?.code !== 'E_NO_SESSION') {
          throw new Error('销毁后会话未立即失效');
        }
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
  const data = await res.json().catch(() => null);
  if (data?.ok !== true) {
    console.error('  ✗ remote-health：未返回 ok=true');
    process.exit(1);
  }
  if (!isSchemaCompatible(SCHEMA_VERSION, data?.version)) {
    console.error(
      `  ✗ remote-version：服务端 ${data?.version ?? '未知'} 与前端 ${SCHEMA_VERSION} 不兼容`
    );
    process.exit(1);
  }
  console.log(`  ✓ remote-health（version ${data?.version}）`);
}

console.log(isRemote ? '[smoke] remote' : '[smoke] local');
await (isRemote ? checkRemote() : checkLocal());
if (process.exitCode !== 1) console.log('[smoke] 通过');
