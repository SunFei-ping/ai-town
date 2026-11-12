import { describe, it, expect } from 'vitest';
import tickHandler from '../../functions/tick/index.js';
import sessionHandler from '../../functions/session/index.js';
import { createModelAdapter } from '../../functions/model/index.js';
import { WARNING_CODES } from '../../shared/errors/codes.js';
import { backfillCappedWarning, warningFrame } from '../../functions/guard/warnings.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import {
  LocalKV,
  framesOfType,
  makeContext,
  openSession,
  parseSSE,
  readFrames,
  tickRequest,
} from '../support/tick.js';

async function setup() {
  const kv = new LocalKV();
  const { token } = await openSession({ kv });
  return { kv, token };
}

function errorCodeOf(result) {
  return result.body?.error?.code;
}

describe('错误码与告警码（error-codes）', () => {
  it('E_NO_SESSION：缺少会话', async () => {
    const kv = new LocalKV();
    const result = await tickHandler({
      method: 'POST',
      path: '/v1/towns/town-test/tick',
      headers: {},
      body: { day_index: 1, context: makeContext() },
      kv,
      env: { MODEL_MODE: 'stub' },
    });
    expect(result.status).toBe(401);
    expect(errorCodeOf(result)).toBe('E_NO_SESSION');
  });

  it('E_KEY_INVALID / E_QUOTA_EXCEEDED：真实校验 Key', async () => {
    const env = { MODEL_MODE: 'live', MODEL_BASE_URL: 'https://model.test/v1' };
    const body = { api_key: 'sk-valid-looking-1234567890' };

    const invalid = await sessionHandler({
      method: 'POST',
      body,
      env,
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    expect(invalid.status).toBe(401);
    expect(errorCodeOf(invalid)).toBe('E_KEY_INVALID');

    const quota = await sessionHandler({
      method: 'POST',
      body,
      env,
      fetchImpl: async () => new Response('{}', { status: 402 }),
    });
    expect(quota.status).toBe(402);
    expect(errorCodeOf(quota)).toBe('E_QUOTA_EXCEEDED');
  });

  it('E_RATE_LIMIT：同一会话每分钟第 7 次被拒绝', async () => {
    const { kv, token } = await setup();
    for (let index = 0; index < 6; index += 1) {
      const result = await tickHandler(
        tickRequest({ kv, token, body: { day_index: 1, context: makeContext() } })
      );
      expect(result.status).toBe(200);
      await readFrames(result);
    }

    const blocked = await tickHandler(
      tickRequest({ kv, token, body: { day_index: 1, context: makeContext() } })
    );
    expect(blocked.status).toBe(429);
    expect(errorCodeOf(blocked)).toBe('E_RATE_LIMIT');
    expect(blocked.headers['X-RateLimit-Limit']).toBe('6');
    expect(blocked.headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('E_TICK_IN_FLIGHT：并发推进同一天', async () => {
    const { kv, token } = await setup();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const stub = createStubModel();
    const slowModel = {
      async complete(input) {
        await gate;
        return stub.complete(input);
      },
    };

    const first = await tickHandler(
      tickRequest({ kv, token, model: slowModel, body: { day_index: 1, context: makeContext() } })
    );
    const second = await tickHandler(
      tickRequest({ kv, token, body: { day_index: 1, context: makeContext() } })
    );
    expect(second.status).toBe(409);
    expect(errorCodeOf(second)).toBe('E_TICK_IN_FLIGHT');

    release();
    await readFrames(first);
  });

  it('E_MODEL_TIMEOUT：整次推进超时产生 error 帧', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        tickTimeoutMs: 30,
        model: { complete: () => new Promise(() => {}) },
        body: { day_index: 1, context: makeContext() },
      })
    );
    const frames = await readFrames(result);
    const error = framesOfType(frames, 'error')[0];
    expect(error.data.code).toBe('E_MODEL_TIMEOUT');
    expect(error.data.retryable).toBe(true);
  });

  it('E_MODEL_OUTPUT：模型输出不是合法 JSON', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: 'sk-valid-1234567890',
      retries: 0,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '不是 JSON' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    await expect(
      adapter.complete({ stage: 'plan', agent: { name: '陈望' }, context: {} })
    ).rejects.toMatchObject({ code: 'E_MODEL_OUTPUT' });
  });

  it('E_TOWN_STATE：day_index 与上下文不一致', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        body: { day_index: 2, context: makeContext({ day: 1 }) },
      })
    );
    expect(result.status).toBe(409);
    expect(errorCodeOf(result)).toBe('E_TOWN_STATE');
  });

  it('E_VALIDATION：居民不是 5 人', async () => {
    const { kv, token } = await setup();
    const context = makeContext();
    context.agents.pop();
    const result = await tickHandler(
      tickRequest({ kv, token, body: { day_index: 1, context } })
    );
    expect(result.status).toBe(400);
    expect(errorCodeOf(result)).toBe('E_VALIDATION');
  });

  it('E_PAYLOAD_TOO_LARGE：请求体超过 256KB', async () => {
    const { kv, token } = await setup();
    const context = makeContext();
    context.agents[0].persona = '长'.repeat(120000);
    const result = await tickHandler(
      tickRequest({ kv, token, body: { day_index: 1, context } })
    );
    expect(result.status).toBe(413);
    expect(errorCodeOf(result)).toBe('E_PAYLOAD_TOO_LARGE');
  });

  it('E_CONTENT_BLOCKED：事件命中安全规则', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        body: {
          day_index: 1,
          context: makeContext(),
          event: { type: 'loss', payload: '有人丢了身份证 110101199001011234' },
        },
      })
    );
    expect(result.status).toBe(422);
    expect(errorCodeOf(result)).toBe('E_CONTENT_BLOCKED');
  });

  it('E_INTERNAL：模型网络异常', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: 'sk-valid-1234567890',
      retries: 0,
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    await expect(
      adapter.complete({ stage: 'plan', agent: { name: '陈望' }, context: {} })
    ).rejects.toMatchObject({ code: 'E_INTERNAL' });
  });

  it('W_LIMIT_CLAMPED / W_STAGE_DEGRADED / W_REPORT_PARTIAL / W_BUDGET_GUARD 随流下发且不关闭流', async () => {
    const { kv, token } = await setup();

    const clamped = await readFrames(
      await tickHandler(
        tickRequest({
          kv,
          token,
          body: { day_index: 1, context: makeContext({ maxContextTokens: 9000 }) },
        })
      )
    );
    expect(framesOfType(clamped, 'warning').some((frame) => frame.data.code === 'W_LIMIT_CLAMPED')).toBe(true);
    expect(framesOfType(clamped, 'done')).toHaveLength(1);

    const degraded = await readFrames(
      await tickHandler(
        tickRequest({
          kv,
          token,
          model: createStubModel({ failOn: 'plan' }),
          body: { day_index: 1, context: makeContext() },
        })
      )
    );
    expect(framesOfType(degraded, 'warning').some((frame) => frame.data.code === 'W_STAGE_DEGRADED')).toBe(true);
    expect(framesOfType(degraded, 'done')).toHaveLength(1);

    const partial = await readFrames(
      await tickHandler(
        tickRequest({
          kv,
          token,
          model: createStubModel({ failOn: 'unsay' }),
          body: { day_index: 1, context: makeContext() },
        })
      )
    );
    expect(framesOfType(partial, 'warning').some((frame) => frame.data.code === 'W_REPORT_PARTIAL')).toBe(true);
    expect(framesOfType(partial, 'done')).toHaveLength(1);

    const budget = await readFrames(
      await tickHandler(
        tickRequest({
          kv,
          token,
          budgetYuan: 0.000001,
          body: { day_index: 1, context: makeContext() },
        })
      )
    );
    expect(framesOfType(budget, 'warning').some((frame) => frame.data.code === 'W_BUDGET_GUARD')).toBe(true);
    expect(framesOfType(budget, 'done')).toHaveLength(1);
  });

  it('5 个告警码都能编码为 warning 帧', () => {
    for (const code of Object.values(WARNING_CODES)) {
      const text = warningFrame(1, code);
      const frames = parseSSE(text);
      expect(frames).toHaveLength(1);
      expect(frames[0].event).toBe('warning');
      expect(frames[0].data.code).toBe(code);
      expect(frames[0].data.message).toBeTruthy();
    }

    const capped = parseSSE(backfillCappedWarning(2, { requested: 5, allowed: 2 }))[0];
    expect(capped.data.code).toBe('W_BACKFILL_CAPPED');
    expect(capped.data.message).toContain('2');
  });
});
