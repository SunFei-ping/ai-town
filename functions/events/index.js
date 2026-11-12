/**
 * 用户事件端点，见 SPCD §7.2 端点 6 与 §7.7。
 *
 * 服务端不保存剧情正文，只做三件事：
 * 1) 鉴权与入参校验（类型白名单、指令性内容、安全规则）
 * 2) 用边缘 KV 的 24 小时幂等存储占位，保证同一小镇同一天至多 1 条用户事件（C3）
 * 3) 返回可直接落库的事件记录
 */
import { getSession } from '../session/index.js';
import { validateEventInput } from '../guard/content.js';
import { errorResult, headerValue, JSON_HEADERS } from '../guard/http.js';
import { createMemoryKV, createRuntimeKV } from '../runtime/kv.js';
import { payloadBytes } from '../../shared/contracts/tick-context.js';
import { LIMITS } from '../../shared/contracts/index.js';
import { ERROR_CODES } from '../../shared/errors/codes.js';
import { newId } from '../../shared/ids.js';

function traceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

function resolveTownId(path, townId) {
  if (townId) return townId;
  const match = /^\/v1\/towns\/([^/]+)\/events\/?$/.exec(String(path ?? ''));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 同一天的用户事件占位键；借用幂等存储，TTL 24 小时 */
function dailyEventKey(day) {
  return `user-event:day-${day}`;
}

export default async function handler(options = {}) {
  const {
    method,
    path,
    headers,
    body,
    kv,
    now = Date.now,
  } = options;

  const trace = traceId();
  const townId = resolveTownId(path, options.townId);

  if (method !== 'POST') {
    return errorResult(ERROR_CODES.E_VALIDATION, 'events 只支持 POST', { traceId: trace });
  }
  if (!townId) {
    return errorResult(ERROR_CODES.E_VALIDATION, '缺少小镇 id', { traceId: trace });
  }

  const session = getSession(headers);
  if (!session) {
    return errorResult(ERROR_CODES.E_NO_SESSION, undefined, { traceId: trace });
  }

  if (payloadBytes(body) > LIMITS.MAX_PAYLOAD_BYTES) {
    return errorResult(ERROR_CODES.E_PAYLOAD_TOO_LARGE, '事件请求体超过 256KB', {
      traceId: trace,
    });
  }
  if (!body || typeof body !== 'object') {
    return errorResult(ERROR_CODES.E_VALIDATION, '事件请求体必须是对象', { traceId: trace });
  }

  const day = Number(body.day);
  if (!Number.isInteger(day) || day < 1 || day > LIMITS.DAYS_PER_TOWN) {
    return errorResult(
      ERROR_CODES.E_TOWN_STATE,
      `事件天数必须在 1–${LIMITS.DAYS_PER_TOWN} 之间`,
      { traceId: trace }
    );
  }

  let validated;
  try {
    validated = validateEventInput({ type: body.type, payload: body.payload });
  } catch (err) {
    const code = Object.hasOwn(ERROR_CODES, err?.code) ? err.code : ERROR_CODES.E_INTERNAL;
    return errorResult(code, err?.message, { traceId: trace });
  }

  const rkv = createRuntimeKV(kv ?? createMemoryKV(), { now });
  const idemKey = headerValue(headers, 'idempotency-key');

  // 同一 Idempotency-Key 的重试返回首次结果
  if (idemKey) {
    const cached = await rkv.getIdempotent(townId, `events:${idemKey}`);
    if (cached?.event) {
      return { status: 200, headers: JSON_HEADERS, body: { event: cached.event } };
    }
  }

  // C3：同一小镇同一天至多 1 条用户事件
  const claimed = await rkv.getIdempotent(townId, dailyEventKey(day));
  if (claimed?.event) {
    return errorResult(ERROR_CODES.E_VALIDATION, '这一天已经投递过事件了', {
      traceId: trace,
    });
  }

  const event = {
    id: newId('evt'),
    town_id: townId,
    day,
    type: validated.type,
    payload: validated.payload,
    source: 'user',
    created_at: now(),
  };

  await rkv.putIdempotent(townId, dailyEventKey(day), { event });
  if (idemKey) await rkv.putIdempotent(townId, `events:${idemKey}`, { event });

  return { status: 200, headers: JSON_HEADERS, body: { event } };
}
