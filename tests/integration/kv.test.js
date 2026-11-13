import { describe, it, expect } from 'vitest';
import { LocalKV } from '../support/tick.js';
import {
  createRuntimeKV,
  kvKeys,
  IDEMPOTENCY_TTL_SECONDS,
  RATE_LIMIT_PER_MIN,
  SNAPSHOT_TTL_SECONDS,
  TICK_LOCK_TTL_SECONDS,
} from '../../functions/runtime/kv.js';

function setup() {
  const kv = new LocalKV();
  const runtime = createRuntimeKV(kv);
  return { kv, runtime };
}

describe('边缘 KV（kv）', () => {
  it('tick 占位：同镇只允许一个，TTL 600 秒，释放后可再次获取', async () => {
    const { kv, runtime } = setup();

    expect(await runtime.acquireTick('town-1', 'tick-a')).toBe(true);
    expect(await runtime.acquireTick('town-1', 'tick-b')).toBe(false);

    const ttl = kv.ttlMs(kvKeys.tick('town-1'));
    expect(ttl).toBeGreaterThan((TICK_LOCK_TTL_SECONDS - 1) * 1000);
    expect(ttl).toBeLessThanOrEqual(TICK_LOCK_TTL_SECONDS * 1000);

    expect(await runtime.releaseTick('town-1', 'tick-a')).toBe(true);
    expect(await runtime.acquireTick('town-1', 'tick-b')).toBe(true);
  });

  it('限流：每会话每分钟 6 次，第 7 次被拒绝', async () => {
    const { runtime } = setup();

    for (let index = 1; index <= RATE_LIMIT_PER_MIN; index += 1) {
      const rate = await runtime.rateLimit('sess-token-1');
      expect(rate.allowed).toBe(true);
      expect(rate.count).toBe(index);
      expect(rate.remaining).toBe(RATE_LIMIT_PER_MIN - index);
    }

    const blocked = await runtime.rateLimit('sess-token-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBeGreaterThan(Date.now() - 60000);
  });

  it('限流按会话隔离', async () => {
    const { runtime } = setup();
    for (let index = 0; index < RATE_LIMIT_PER_MIN; index += 1) {
      await runtime.rateLimit('sess-a');
    }
    const other = await runtime.rateLimit('sess-b');
    expect(other.allowed).toBe(true);
  });

  it('幂等键保存 24 小时', async () => {
    const { kv, runtime } = setup();

    await runtime.putIdempotent('town-1', 'idem-1', { ok: true });
    expect(await runtime.getIdempotent('town-1', 'idem-1')).toEqual({ ok: true });

    const ttl = kv.ttlMs(kvKeys.idempotency('town-1', 'idem-1'));
    expect(ttl).toBeGreaterThan((IDEMPOTENCY_TTL_SECONDS - 1) * 1000);
    expect(ttl).toBeLessThanOrEqual(IDEMPOTENCY_TTL_SECONDS * 1000);
  });

  it('会话索引只存摘要与不透明引用，不存明文 Key 或 token', async () => {
    const { kv, runtime } = setup();
    const token = 'sess_plain_token_1234567890';
    const keyRef = 'ref_opaque_abc';

    await runtime.putSessionIndex(token, keyRef);
    const stored = kv.get(kvKeys.sessionIndex(token));

    expect(stored.key_ref).toBe(keyRef);
    expect(typeof stored.token_hash).toBe('string');
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('api_key');
  });

  it('续传快照 TTL 10 分钟', async () => {
    const { kv, runtime } = setup();
    await runtime.saveSnapshot('town-1', 3, { done: false, frames: [] });

    const ttl = kv.ttlMs(kvKeys.snapshot('town-1', 3));
    expect(ttl).toBeGreaterThan((SNAPSHOT_TTL_SECONDS - 1) * 1000);
    expect(ttl).toBeLessThanOrEqual(SNAPSHOT_TTL_SECONDS * 1000);
  });

  it('兼容异步 KV（get/put 风格）', async () => {
    const store = new Map();
    const asyncKV = {
      async get(key) {
        return store.get(key);
      },
      async put(key, value) {
        store.set(key, value);
      },
      async delete(key) {
        store.delete(key);
      },
    };
    const runtime = createRuntimeKV(asyncKV);
    expect(await runtime.acquireTick('town-x', 'tick-x')).toBe(true);
    expect(await runtime.getTick('town-x')).toMatchObject({ tick_id: 'tick-x' });
    expect(await runtime.releaseTick('town-x', 'tick-x')).toBe(true);
  });

  it('兼容只接受字符串的 Cloudflare KV：结构化值按 JSON 存取', async () => {
    const store = new Map();
    const platformKV = {
      async put(key, value, options) {
        if (typeof value !== 'string') throw new Error('KV PUT failed: value must be a string');
        const ttl = options?.expirationTtl;
        if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 60)) {
          throw new Error('KV PUT failed: expirationTtl must be at least 60');
        }
        store.set(key, value);
      },
      async get(key) {
        return store.get(key);
      },
      async delete(key) {
        store.delete(key);
      },
    };
    const runtime = createRuntimeKV(platformKV);

    // 限流键的窗口剩余时间可能不足 60 秒，必须被兜底为 60
    const rate = await runtime.rateLimit('sess-cf');
    expect(rate.allowed).toBe(true);

    expect(await runtime.acquireTick('town-cf', 'tick-cf')).toBe(true);
    expect(await runtime.getTick('town-cf')).toMatchObject({ tick_id: 'tick-cf' });

    await runtime.putSessionIndex('sess-cf', 'ref-cf');
    expect(await runtime.getSessionIndex('sess-cf')).toMatchObject({ key_ref: 'ref-cf' });

    await runtime.saveSnapshot('town-cf', 1, { done: true });
    expect(await runtime.getSnapshot('town-cf', 1)).toEqual({ done: true });
  });
});
