import { toErrorBody, ERROR_CODES } from '../../shared/errors/codes.js';
import { LIMITS } from '../../shared/contracts/index.js';
import { fail } from '../../shared/errors/app-error.js';
import { verifyApiKey } from '../model/index.js';
import { createRuntimeKV } from '../runtime/kv.js';
import { errorResult } from '../guard/http.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * Key 只在内存中驻留，不落盘、不进日志（SPCD §9.2）。
 * 进程重启或 TTL 到期即失效，前端需要重新粘贴。
 *
 * 挂在 globalThis 上，保证开发服务器热加载函数模块时仍共用同一份会话。
 */
const SESSION_STORE = globalThis.__aiTownSessions ?? new Map();
globalThis.__aiTownSessions = SESSION_STORE;

function traceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

function purgeExpired() {
  const now = Date.now();
  for (const [token, session] of SESSION_STORE) {
    if (session.expiresAt <= now) SESSION_STORE.delete(token);
  }
}

function bearer(headers) {
  const raw = headers?.authorization ?? headers?.Authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw));
  return match ? match[1].trim() : '';
}

function resolveEnv(env) {
  return env ?? globalThis.process?.env ?? {};
}

function modelMode(env) {
  if (env.MODEL_MODE === 'stub') return 'stub';
  if (env.MODEL_MODE === 'live') return 'live';
  return env.MODEL_BASE_URL ? 'live' : 'stub';
}

/**
 * 本地/测试环境未配置模型服务时退化为格式校验，保证 M0/M1 的离线链路可用。
 * 配置了 MODEL_BASE_URL 或 MODEL_MODE=live 时执行真实校验。
 */
async function validateApiKey(apiKey, { env, fetchImpl }) {
  if (apiKey.length < 8 || apiKey.startsWith('invalid')) {
    fail(ERROR_CODES.E_KEY_INVALID);
  }
  if (modelMode(env) === 'stub') return { mode: 'stub' };

  await verifyApiKey({
    baseUrl: env.MODEL_BASE_URL,
    apiKey,
    fetchImpl,
    timeoutMs: Number(env.MODEL_TIMEOUT_MS) || 5000,
  });
  return { mode: 'live' };
}

export default async function handler({ method, headers, body, kv, env, fetchImpl } = {}) {
  purgeExpired();

  const resolvedEnv = resolveEnv(env);
  const resolvedFetch = fetchImpl ?? globalThis.fetch;
  const runtimeKV = kv ? createRuntimeKV(kv) : null;
  const trace = traceId();

  if (method === 'POST') {
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    if (!apiKey) {
      return {
        status: 400,
        headers: JSON_HEADERS,
        body: toErrorBody(ERROR_CODES.E_VALIDATION, '请填写 API Key', trace),
      };
    }

    try {
      await validateApiKey(apiKey, { env: resolvedEnv, fetchImpl: resolvedFetch });
    } catch (err) {
      return errorResult(err.code, err.message, { traceId: trace });
    }

    const token = `sess_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const expiresAt = Date.now() + LIMITS.SESSION_TTL_MS;
    const keyRef = `ref_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

    SESSION_STORE.set(token, { apiKey, keyRef, expiresAt });
    // 会话索引只保存不透明引用，绝不在 KV 中留下 Key；索引失败不阻塞会话
    try {
      await runtimeKV?.putSessionIndex(token, keyRef);
    } catch {
      /* 边缘 KV 不可用时仍允许当前实例内的会话继续使用 */
    }

    return {
      status: 200,
      headers: JSON_HEADERS,
      body: { session_token: token, expires_at: expiresAt },
    };
  }

  if (method === 'DELETE') {
    const token = bearer(headers);
    if (!token || !SESSION_STORE.has(token)) {
      return {
        status: 401,
        headers: JSON_HEADERS,
        body: toErrorBody(ERROR_CODES.E_NO_SESSION, undefined, trace),
      };
    }
    SESSION_STORE.delete(token);
    await runtimeKV?.deleteSessionIndex(token);
    return { status: 204, headers: JSON_HEADERS, body: '' };
  }

  return {
    status: 405,
    headers: JSON_HEADERS,
    body: toErrorBody(ERROR_CODES.E_VALIDATION, 'session 只支持 POST / DELETE', trace),
  };
}

/** 供 tick 端点复用的会话查询 */
export function getSession(headers) {
  purgeExpired();
  const token = bearer(headers);
  const session = token ? SESSION_STORE.get(token) : null;
  return session ? { token, ...session } : null;
}
