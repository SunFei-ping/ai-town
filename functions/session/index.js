import { toErrorBody, ERROR_CODES } from '../../shared/errors/codes.js';
import { LIMITS } from '../../shared/contracts/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * Key 只在内存中驻留，不落盘、不进日志（SPCD §9.2）。
 * 进程重启或 TTL 到期即失效，前端需要重新粘贴。
 */
const sessions = new Map();

function traceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

function purgeExpired() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function bearer(headers) {
  const raw = headers?.authorization ?? headers?.Authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw));
  return match ? match[1].trim() : '';
}

export default async function handler({ method, headers, body }) {
  purgeExpired();

  if (method === 'POST') {
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    if (!apiKey) {
      return {
        status: 400,
        headers: JSON_HEADERS,
        body: toErrorBody(ERROR_CODES.E_VALIDATION, '请填写 API Key', traceId()),
      };
    }
    if (apiKey.length < 8 || apiKey.startsWith('invalid')) {
      return {
        status: 401,
        headers: JSON_HEADERS,
        body: toErrorBody(ERROR_CODES.E_KEY_INVALID, undefined, traceId()),
      };
    }

    const token = `sess_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const expiresAt = Date.now() + LIMITS.SESSION_TTL_MS;
    sessions.set(token, { apiKey, expiresAt });

    return {
      status: 200,
      headers: JSON_HEADERS,
      body: { session_token: token, expires_at: expiresAt },
    };
  }

  if (method === 'DELETE') {
    const token = bearer(headers);
    if (!token || !sessions.has(token)) {
      return {
        status: 401,
        headers: JSON_HEADERS,
        body: toErrorBody(ERROR_CODES.E_NO_SESSION, undefined, traceId()),
      };
    }
    sessions.delete(token);
    return { status: 204, headers: JSON_HEADERS, body: '' };
  }

  return {
    status: 405,
    headers: JSON_HEADERS,
    body: toErrorBody(ERROR_CODES.E_VALIDATION, 'session 只支持 POST / DELETE', traceId()),
  };
}

/** 供后续 tick 端点复用的会话查询 */
export function getSession(headers) {
  purgeExpired();
  const token = bearer(headers);
  const session = token ? sessions.get(token) : null;
  return session ? { token, ...session } : null;
}
