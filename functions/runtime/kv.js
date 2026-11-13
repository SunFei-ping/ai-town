/**
 * 边缘 KV 适配层，见 task.md M5-03 与 SPCD §10.3。
 *
 * 四类键：
 * - tick 占位：同一小镇同时只允许一个 tick，TTL 600 秒
 * - 限流计数：按 session_token 每分钟 6 次
 * - 幂等键：Idempotency-Key 保存 24 小时
 * - 会话索引：只存不可逆的 token 摘要与 Key 的加密引用，绝不存明文 Key
 *
 * 同时兼容本地 LocalKV（同步 set/get/incr）与平台 KV（异步 get/put）。
 */
import { LIMITS } from '../../shared/contracts/index.js';

export const TICK_LOCK_TTL_SECONDS = LIMITS.TICK_LOCK_TTL_SECONDS;
export const RATE_LIMIT_PER_MIN = LIMITS.RATE_LIMIT_PER_MIN;
export const RATE_WINDOW_MS = 60 * 1000;
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
export const SNAPSHOT_TTL_SECONDS = 10 * 60;
export const SESSION_INDEX_TTL_SECONDS = Math.ceil(LIMITS.SESSION_TTL_MS / 1000);

/** 键名集中在这里，避免各模块各写一套 */
export const kvKeys = Object.freeze({
  tick: (townId) => `tick:${townId}`,
  rate: (sessionToken, minute) => `rate:${digest(sessionToken)}:${minute}`,
  idempotency: (townId, key) => `idem:${townId}:${key}`,
  sessionIndex: (sessionToken) => `session:${digest(sessionToken)}`,
  snapshot: (townId, day) => `snapshot:${townId}:${day}`,
});

/**
 * 非加密摘要，仅用于键名，不可反推原文。
 * 真正的凭据引用使用随机 key_ref（见 createRuntimeKV.putSessionIndex）。
 */
export function digest(value) {
  const text = String(value ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code * (index + 1), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function isPlatformKV(kv) {
  return typeof kv?.put === 'function';
}

async function read(kv, key) {
  if (!kv) return undefined;
  if (typeof kv.get === 'function') {
    const raw = await kv.get(key);
    if (isPlatformKV(kv) && typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return undefined;
}

async function write(kv, key, value, ttlSeconds) {
  if (!kv) return false;
  if (isPlatformKV(kv)) {
    // Cloudflare KV 只接受字符串/二进制，结构化值统一按 JSON 存取；
    // 同时 expirationTtl 必须是 ≥60 的整数，短窗口限流键按 60 秒兜底
    const ttl = ttlSeconds ? Math.max(60, Math.ceil(ttlSeconds)) : undefined;
    await kv.put(
      key,
      JSON.stringify(value ?? null),
      ttl ? { expirationTtl: ttl } : undefined
    );
    return true;
  }
  if (typeof kv.set === 'function') {
    kv.set(key, value, ttlSeconds);
    return true;
  }
  return false;
}

async function remove(kv, key) {
  if (!kv) return false;
  if (typeof kv.delete === 'function') return kv.delete(key);
  return false;
}

async function bump(kv, key, ttlSeconds) {
  if (kv && typeof kv.incr === 'function') return kv.incr(key, ttlSeconds);
  const current = Number((await read(kv, key)) ?? 0) + 1;
  await write(kv, key, current, ttlSeconds);
  return current;
}

/** 没有平台 KV 时的内存兜底（同样带 TTL） */
export function createMemoryKV(clock = Date.now) {
  const store = new Map();
  function alive(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && clock() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }
  return {
    set(key, value, ttlSeconds = null) {
      store.set(key, {
        value,
        expiresAt: ttlSeconds === null ? null : clock() + ttlSeconds * 1000,
      });
      return true;
    },
    get(key) {
      return alive(key)?.value;
    },
    delete(key) {
      return store.delete(key);
    },
    incr(key, ttlSeconds = 60) {
      const entry = alive(key);
      if (!entry) {
        this.set(key, 1, ttlSeconds);
        return 1;
      }
      const next = Number(entry.value) + 1;
      store.set(key, { value: next, expiresAt: entry.expiresAt });
      return next;
    },
    ttlMs(key) {
      const entry = alive(key);
      if (!entry || entry.expiresAt === null) return null;
      return Math.max(0, entry.expiresAt - clock());
    },
    clear() {
      store.clear();
    },
  };
}

export function createRuntimeKV(kv = createMemoryKV(), { now = Date.now } = {}) {
  return {
    async acquireTick(townId, tickId) {
      const key = kvKeys.tick(townId);
      const existing = await read(kv, key);
      if (existing) return false;
      await write(kv, key, { tick_id: tickId, started_at: now() }, TICK_LOCK_TTL_SECONDS);
      return true;
    },

    async releaseTick(townId, tickId) {
      const key = kvKeys.tick(townId);
      const existing = await read(kv, key);
      if (!existing) return false;
      if (tickId && existing.tick_id && existing.tick_id !== tickId) return false;
      await remove(kv, key);
      return true;
    },

    async getTick(townId) {
      return read(kv, kvKeys.tick(townId));
    },

    /**
     * 固定窗口限流：每会话每分钟 6 次。
     * @returns {{allowed:boolean,count:number,limit:number,remaining:number,resetAt:number}}
     */
    async rateLimit(sessionToken) {
      const current = now();
      const minute = Math.floor(current / RATE_WINDOW_MS);
      const ttl = Math.ceil((RATE_WINDOW_MS - (current % RATE_WINDOW_MS)) / 1000);
      const count = await bump(kv, kvKeys.rate(sessionToken, minute), ttl);
      const limit = RATE_LIMIT_PER_MIN;
      return {
        allowed: count <= limit,
        count,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt: minute * RATE_WINDOW_MS + RATE_WINDOW_MS,
      };
    },

    async getIdempotent(townId, key) {
      return read(kv, kvKeys.idempotency(townId, key));
    },

    async putIdempotent(townId, key, value) {
      return write(kv, kvKeys.idempotency(townId, key), value, IDEMPOTENCY_TTL_SECONDS);
    },

    /**
     * 会话索引只保存 token 摘要与 Key 的加密引用（key_ref 为随机不透明串）。
     */
    async putSessionIndex(sessionToken, keyRef) {
      const value = {
        token_hash: digest(sessionToken),
        key_ref: keyRef,
        created_at: now(),
      };
      return write(kv, kvKeys.sessionIndex(sessionToken), value, SESSION_INDEX_TTL_SECONDS);
    },

    async getSessionIndex(sessionToken) {
      return read(kv, kvKeys.sessionIndex(sessionToken));
    },

    async deleteSessionIndex(sessionToken) {
      return remove(kv, kvKeys.sessionIndex(sessionToken));
    },

    async saveSnapshot(townId, day, snapshot) {
      return write(kv, kvKeys.snapshot(townId, day), snapshot, SNAPSHOT_TTL_SECONDS);
    },

    async getSnapshot(townId, day) {
      return read(kv, kvKeys.snapshot(townId, day));
    },

    async deleteSnapshot(townId, day) {
      return remove(kv, kvKeys.snapshot(townId, day));
    },
  };
}
