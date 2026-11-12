import { describe, it, expect } from 'vitest';
import eventsHandler from '../../functions/events/index.js';
import { LocalKV, openSession } from '../support/tick.js';

function eventsRequest({ townId = 'town-test', token, body, headers = {}, kv } = {}) {
  return {
    method: 'POST',
    path: `/v1/towns/${townId}/events`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body,
    kv,
    env: { MODEL_MODE: 'stub' },
  };
}

async function setup() {
  const kv = new LocalKV();
  const { token } = await openSession({ kv });
  return { kv, token };
}

const VALID = { day: 2, type: 'loss', payload: '有人在码头丢了一个钱包' };

describe('事件端点（events）', () => {
  it('缺少会话返回 E_NO_SESSION', async () => {
    const kv = new LocalKV();
    const result = await eventsHandler({
      method: 'POST',
      path: '/v1/towns/town-test/events',
      headers: {},
      body: VALID,
      kv,
    });
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('E_NO_SESSION');
  });

  it('未知类型一律拒绝（不做静默兼容）', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler(
      eventsRequest({ kv, token, body: { ...VALID, type: 'alien' } })
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('E_VALIDATION');
  });

  it('含对居民的直接指令返回 E_VALIDATION', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler(
      eventsRequest({ kv, token, body: { day: 1, type: 'rumor', payload: '让陈望去表白' } })
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('E_VALIDATION');
  });

  it('命中安全规则返回 E_CONTENT_BLOCKED', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler(
      eventsRequest({ kv, token, body: { day: 1, type: 'loss', payload: '有人丢了手机号 13800138000' } })
    );
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('E_CONTENT_BLOCKED');
  });

  it('合法事件返回 event 结构', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler(eventsRequest({ kv, token, body: VALID }));
    expect(result.status).toBe(200);
    const { event } = result.body;
    expect(event).toMatchObject({
      town_id: 'town-test',
      day: 2,
      type: 'loss',
      payload: '有人在码头丢了一个钱包',
      source: 'user',
    });
    expect(typeof event.id).toBe('string');
    expect(Number.isInteger(event.created_at)).toBe(true);
  });

  it('C3：同一小镇同一天至多 1 条用户事件', async () => {
    const { kv, token } = await setup();
    const first = await eventsHandler(eventsRequest({ kv, token, body: VALID }));
    expect(first.status).toBe(200);

    const second = await eventsHandler(
      eventsRequest({ kv, token, body: { ...VALID, payload: '又有人丢了伞' } })
    );
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('E_VALIDATION');
  });

  it('不同天可以各投递 1 条', async () => {
    const { kv, token } = await setup();
    expect((await eventsHandler(eventsRequest({ kv, token, body: { ...VALID, day: 1 } }))).status).toBe(200);
    expect((await eventsHandler(eventsRequest({ kv, token, body: { ...VALID, day: 2 } }))).status).toBe(200);
  });

  it('同一 Idempotency-Key 重试返回首次结果', async () => {
    const { kv, token } = await setup();
    const headers = { 'idempotency-key': 'evt-1' };
    const first = await eventsHandler(eventsRequest({ kv, token, body: VALID, headers }));
    const retry = await eventsHandler(eventsRequest({ kv, token, body: VALID, headers }));
    expect(retry.status).toBe(200);
    expect(retry.body.event.id).toBe(first.body.event.id);
  });

  it('天数越界返回 E_TOWN_STATE', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler(
      eventsRequest({ kv, token, body: { ...VALID, day: 8 } })
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('E_TOWN_STATE');
  });

  it('非 POST 方法返回 E_VALIDATION', async () => {
    const { kv, token } = await setup();
    const result = await eventsHandler({
      method: 'GET',
      path: '/v1/towns/town-test/events',
      headers: { authorization: `Bearer ${token}` },
      kv,
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('E_VALIDATION');
  });
});
