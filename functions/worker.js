/**
 * Cloudflare Workers 入口，见 SPCD §13.3。
 *
 * 本地开发走 scripts/dev-server.mjs；线上由本文件把请求路由到
 * functions/<name>/index.js，边缘 KV 通过 AI_TOWN_KV 绑定注入。
 */
import health from './health/index.js';
import session from './session/index.js';
import tick from './tick/index.js';
import events from './events/index.js';

const ROUTES = [
  { pattern: /^\/v1\/health\/?$/, handler: health },
  { pattern: /^\/v1\/session\/?$/, handler: session },
  { pattern: /^\/v1\/towns\/([^/]+)\/tick\/?$/, handler: tick, town: true },
  { pattern: /^\/v1\/towns\/([^/]+)\/events\/?$/, handler: events, town: true },
];

function match(pathname) {
  for (const route of ROUTES) {
    const found = route.pattern.exec(pathname);
    if (found) {
      return {
        handler: route.handler,
        townId: route.town ? decodeURIComponent(found[1]) : undefined,
      };
    }
  }
  return null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const found = match(url.pathname);
    if (!found) {
      return json(404, { error: { code: 'E_INTERNAL', message: '未知接口', retryable: false } });
    }

    let body;
    try {
      body = await readBody(request);
    } catch {
      return json(413, { error: { code: 'E_PAYLOAD_TOO_LARGE', message: '请求体过大' } });
    }

    const result = await found.handler({
      method: request.method,
      path: url.pathname,
      townId: found.townId,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      kv: env?.AI_TOWN_KV,
      env,
      fetchImpl: globalThis.fetch,
    });

    const headers = { 'Cache-Control': 'no-store', ...(result.headers ?? {}) };
    if (result.stream) {
      return new Response(result.stream, { status: result.status ?? 200, headers });
    }

    const payload = typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null);
    return new Response(payload, { status: result.status ?? 200, headers });
  },
};
