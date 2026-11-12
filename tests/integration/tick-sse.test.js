import { describe, it, expect } from 'vitest';
import tickHandler from '../../functions/tick/index.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import { streamTick } from '../../web/infra/api/sse.js';
import {
  LocalKV,
  framesOfType,
  makeContext,
  openSession,
  readFrames,
  tickRequest,
} from '../support/tick.js';

async function setup(extra = {}) {
  const kv = new LocalKV();
  const { token } = await openSession({ kv });
  return { kv, token, ...extra };
}

describe('tick 端点与 SSE（tick-sse）', () => {
  it('响应头符合 §7.2：text/event-stream / no-store / X-Accel-Buffering', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        body: { day_index: 1, context: makeContext() },
      })
    );

    expect(result.status).toBe(200);
    expect(result.headers['Content-Type']).toContain('text/event-stream');
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.headers['X-Accel-Buffering']).toBe('no');

    await readFrames(result);
  });

  it('帧类型齐全且顺序正确', async () => {
    const { kv, token } = await setup();
    const result = await tickHandler(
      tickRequest({
        kv,
        token,
        body: { day_index: 1, context: makeContext() },
      })
    );
    const frames = await readFrames(result);
    const types = frames.map((frame) => frame.event);

    expect(types[0]).toBe('accepted');
    expect(types.at(-1)).toBe('done');
    expect(framesOfType(frames, 'planning')).toHaveLength(5);
    expect(framesOfType(frames, 'unsaid')).toHaveLength(5);
    expect(framesOfType(frames, 'dialogue').length).toBeGreaterThan(0);
    expect(framesOfType(frames, 'report_ready')).toHaveLength(1);

    const report = framesOfType(frames, 'report_ready')[0].data.report;
    expect(report.sections).toHaveLength(4);
    expect(report.unsays).toHaveLength(5);

    const done = framesOfType(frames, 'done')[0].data;
    const dialogues = framesOfType(frames, 'dialogue').length;
    expect(done.usage.calls).toBe(5 + dialogues + 5);
    expect(done.usage.total_tokens).toBeGreaterThan(0);
    expect(done.usage.cost_yuan).toBeGreaterThan(0);
  });

  it('并发第二次请求返回 E_TICK_IN_FLIGHT', async () => {
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
      tickRequest({
        kv,
        token,
        model: slowModel,
        body: { day_index: 1, context: makeContext() },
      })
    );
    expect(first.status).toBe(200);

    const second = await tickHandler(
      tickRequest({
        kv,
        token,
        body: { day_index: 1, context: makeContext() },
      })
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('E_TICK_IN_FLIGHT');

    release();
    await readFrames(first);
  });

  it('同一 Idempotency-Key 返回首次结果，不重复调用模型', async () => {
    const { kv, token } = await setup();
    const model = createStubModel();
    const body = { day_index: 1, context: makeContext() };

    const first = await tickHandler(
      tickRequest({ kv, token, model, headers: { 'idempotency-key': 'same-key' }, body })
    );
    const firstFrames = await readFrames(first);
    const firstCalls = model.calls;

    const second = await tickHandler(
      tickRequest({ kv, token, model, headers: { 'idempotency-key': 'same-key' }, body })
    );
    const secondFrames = await readFrames(second);

    expect(secondFrames.map((frame) => frame.id)).toEqual(firstFrames.map((frame) => frame.id));
    expect(secondFrames.map((frame) => frame.event)).toEqual(firstFrames.map((frame) => frame.event));
    expect(model.calls).toBe(firstCalls);
  });

  it('前端 SSE 客户端使用 fetch 读取并解析帧', async () => {
    const payload =
      ': ping\n\n' +
      'event: accepted\nid: 1\ndata: {"tick_id":"t1"}\n\n' +
      'event: done\nid: 2\ndata: {"day_index":1,"usage":{"calls":11}}\n\n';

    let requestedUrl = '';
    let requestedHeaders = null;
    const fetchImpl = async (url, options) => {
      requestedUrl = url;
      requestedHeaders = options.headers;
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(payload.slice(0, 20)));
          controller.enqueue(encoder.encode(payload.slice(20)));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const seen = [];
    const { frames, usage } = await streamTick({
      townId: 'town-live',
      dayIndex: 1,
      context: makeContext({ townId: 'town-live' }),
      sessionToken: 'sess_x',
      fetchImpl,
      onFrame: (frame) => seen.push(frame.event),
    });

    expect(requestedUrl).toBe('/v1/towns/town-live/tick');
    expect(requestedHeaders.Authorization).toBe('Bearer sess_x');
    expect(frames.map((frame) => frame.event)).toEqual(['accepted', 'done']);
    expect(seen).toEqual(['accepted', 'done']);
    expect(usage.calls).toBe(11);
  });

  it('SSE 客户端收到 error 帧时抛出对应错误码', async () => {
    const fetchImpl = async () =>
      new Response(
        'event: error\nid: 1\ndata: {"code":"E_MODEL_TIMEOUT","message":"超时","retryable":true}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );

    await expect(
      streamTick({
        townId: 'town-live',
        dayIndex: 1,
        context: makeContext(),
        sessionToken: 'sess_x',
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'E_MODEL_TIMEOUT' });
  });
});
