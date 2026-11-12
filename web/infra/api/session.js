/**
 * 前端会话客户端，见 SPCD §7.2 端点 1 / 2。
 *
 * 只保存服务端签发的 session_token 与有效期，绝不保存 API Key。
 * 使用 sessionStorage：关闭标签页即失效，符合「Key 仅在内存驻留」的方向。
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

const STORAGE_KEY = 'ai-town.session';

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(session) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* 隐私模式下忽略，当前页仍可使用内存中的返回值 */
  }
}

function clearStored() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 取有效会话；过期自动清理 */
export function getSession() {
  const session = readStored();
  if (!session?.session_token) return null;
  if (Number(session.expires_at) <= Date.now()) {
    clearStored();
    return null;
  }
  return session;
}

/** POST /v1/session：真实校验 Key，成功后只保留 token */
export async function openSession(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey ?? '').trim();
  if (!key) {
    throw new AppError(ERROR_CODES.E_VALIDATION, '请填写 API Key');
  }

  const res = await fetchImpl('/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key }),
  });
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new AppError(
      payload?.error?.code ?? ERROR_CODES.E_INTERNAL,
      payload?.error?.message ?? 'Key 校验失败',
      payload
    );
  }

  const session = {
    session_token: payload.session_token,
    expires_at: payload.expires_at,
  };
  writeStored(session);
  return session;
}

/** DELETE /v1/session：主动销毁，失败也清理本地 */
export async function destroySession({ fetchImpl = globalThis.fetch } = {}) {
  const session = getSession();
  clearStored();
  if (!session) return;
  try {
    await fetchImpl('/v1/session', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.session_token}` },
    });
  } catch {
    /* 断网时只做本地清理 */
  }
}
