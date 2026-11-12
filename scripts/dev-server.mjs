/**
 * 本地开发服务器。
 *
 * 职责：
 * 1) 托管 web/ 下的静态资源（无需构建）
 * 2) 把 /v1/* 转发给 functions/<name>/index.js（若存在）
 * 3) 用 LocalKV 模拟边缘 KV
 * 4) 提供 /_dev/runtime 供冒烟脚本验证运行时与 KV 是否就绪
 *
 * 生产环境不会使用本文件，函数由平台运行时托管。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalKV } from './local-kv.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(root, 'web');
const port = Number(process.env.PORT ?? 4173);
const kv = new LocalKV();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('E_PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function serveDevRuntime(res) {
  const key = 'dev:probe';
  kv.set(key, 'ok', 30);
  const value = kv.get(key);
  const counter = kv.incr('dev:counter', 60);
  send(
    res,
    200,
    'application/json; charset=utf-8',
    JSON.stringify({ ok: value === 'ok', kv: true, counter, ttlMs: kv.ttlMs(key) })
  );
}

async function serveFunction(req, res, pathname) {
  // 支持 /v1/<name> 与 /v1/towns/<id>/<name> 两种路由
  const segments = pathname.split('/').filter(Boolean);
  const isTownRoute = segments[1] === 'towns' && segments.length >= 4;
  const name = isTownRoute ? segments[3] : segments[1];
  const townId = isTownRoute ? decodeURIComponent(segments[2]) : undefined;

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'E_INTERNAL', message: '未知接口' } }));
    return;
  }
  const file = join(root, 'functions', name, 'index.js');
  if (!existsSync(file)) {
    send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'E_INTERNAL', message: `接口 ${name} 尚未实现` } }));
    return;
  }
  const mod = await import(`file://${file.replace(/\\/g, '/')}?t=${Date.now()}`);
  const handler = mod.default;
  if (typeof handler !== 'function') {
    send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'E_INTERNAL', message: '处理器未导出' } }));
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const result = await handler({
    method: req.method,
    path: pathname,
    townId,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
    body: await readBody(req),
    kv,
    env: process.env,
  });
  const headers = { 'Cache-Control': 'no-store', ...(result.headers ?? {}) };
  res.writeHead(result.status ?? 200, headers);

  // SSE 等流式响应：逐帧写回，禁止缓冲
  if (result.stream) {
    res.flushHeaders?.();
    const reader = result.stream.getReader();
    res.on('close', () => {
      if (!res.writableEnded) reader.cancel().catch(() => {});
    });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* 客户端已断开 */
    }
    res.end();
    return;
  }

  res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null));
}

async function serveStatic(res, pathname, baseDir = webRoot, prefix = '/') {
  const decoded = decodeURIComponent(pathname);
  const rel = decoded.replace(new RegExp(`^\\${prefix}`), '').replace(/^\/+/, '');
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = join(baseDir, safe === '' || safe === '.' ? 'index.html' : safe);
  if (!file.startsWith(baseDir)) {
    send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }
  if (!existsSync(file) && !extname(file)) {
    file = join(webRoot, 'index.html');
  }
  try {
    const data = await readFile(file);
    send(res, 200, MIME[extname(file)] ?? 'application/octet-stream', data);
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (pathname === '/_dev/runtime') {
        await serveDevRuntime(res);
        return;
      }
      if (pathname.startsWith('/v1/')) {
        await serveFunction(req, res, pathname);
        return;
      }
      if (pathname.startsWith('/data/')) {
        await serveStatic(res, pathname, join(root, 'data'), '/data/');
        return;
      }
      if (pathname.startsWith('/shared/')) {
        await serveStatic(res, pathname, join(root, 'shared'), '/shared/');
        return;
      }
      await serveStatic(res, pathname);
    } catch (err) {
      const code = err?.message === 'E_PAYLOAD_TOO_LARGE' ? 413 : 500;
      send(res, code, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'E_INTERNAL', message: String(err?.message ?? err) } }));
    }
  });
}

const server = createServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`[dev] listening on http://127.0.0.1:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
