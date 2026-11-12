/**
 * Tick 端点与 SSE，见 SPCD §7.2 端点 5、§7.6 全部帧类型，以及 task.md M5-04 ~ M5-07。
 *
 * 服务端不存储小镇状态：上下文由前端传入，服务端只负责在内存里推进一天，
 * 通过 SSE 把每个阶段的结果推回去。边缘 KV 只保存占位、限流、幂等与续传快照。
 */
import { TickMachine } from '../../web/domain/simulation/tick-machine.js';
import { generatePlans } from '../../web/domain/agent/plan.js';
import { generateUnsay } from '../../web/domain/agent/unsay.js';
import { ensureUnsays } from '../../web/domain/report/unsay.js';
import { buildReport } from '../../web/domain/report/builder.js';
import { collectEncounters } from '../../web/domain/simulation/encounter.js';
import { generateDialogue } from '../../web/domain/simulation/dialogue.js';
import { guardDialogue, guardText } from '../../web/domain/memory/secretGuard.js';
import { planRelationUpdates } from '../../web/domain/relation/rules.js';
import { createStubModel } from '../../web/infra/api/stub-model.js';
import { validateTickContext, payloadBytes } from '../../shared/contracts/tick-context.js';
import { LIMITS } from '../../shared/contracts/index.js';
import { ERROR_CODES, ERROR_RETRYABLE, WARNING_CODES } from '../../shared/errors/codes.js';
import { getSession } from '../session/index.js';
import {
  createModelAdapter,
  createRedactedLogger,
  normalizeUsage,
  usageCost,
} from '../model/index.js';
import { createMemoryKV, createRuntimeKV } from '../runtime/kv.js';
import {
  SSE_HEADERS,
  encodeFrame,
  errorFrame,
  errorResult,
  headerValue,
  rateLimitHeaders,
  toErrorResult,
} from '../guard/http.js';
import { createWarning } from '../guard/warnings.js';
import { validateEventInput } from '../guard/content.js';
import { createBudgetGuard } from '../guard/budget.js';

export const DEFAULT_TICK_TIMEOUT_MS = 150000;
const SNAPSHOT_POLL_MS = 200;

function traceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

function tickId() {
  return `tick_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function resolveTownId(path, townId) {
  if (townId) return townId;
  const match = /^\/v1\/towns\/([^/]+)\/tick\/?$/.exec(String(path ?? ''));
  return match ? decodeURIComponent(match[1]) : null;
}

function modelMode(env) {
  if (env.MODEL_MODE === 'stub') return 'stub';
  if (env.MODEL_MODE === 'live') return 'live';
  return env.MODEL_BASE_URL ? 'live' : 'stub';
}

function resolveModel({ env, session, fetchImpl }) {
  if (modelMode(env) === 'stub') return createStubModel();
  return createModelAdapter({
    baseUrl: env.MODEL_BASE_URL,
    modelName: env.MODEL_NAME ?? 'gpt-4o-mini',
    apiKey: session.apiKey,
    timeoutMs: Number(env.MODEL_TIMEOUT_MS) || undefined,
    retries: env.MODEL_RETRIES === undefined ? undefined : Number(env.MODEL_RETRIES),
    fetchImpl,
    logger: env.MODEL_LOG ? createRedactedLogger(console) : null,
  });
}

function summarizeUsage(records, prices) {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const record of records) {
    input += record.input_tokens;
    output += record.output_tokens;
    cost += usageCost(record, prices);
  }
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cost_yuan: Number(cost.toFixed(6)),
    calls: records.length,
  };
}

/** 把模型调用包一层：计量、成本护栏、调用记录 */
function createMeteredModel(model, { townId, day, onUsage, budgetGuard, onBudgetWarning }) {
  return {
    async complete(input) {
      const started = Date.now();
      const result = await model.complete(input);
      const usage = normalizeUsage(result?.usage, {
        prompt: input,
        output: result,
      });
      const record = {
        town_id: townId,
        day,
        stage: input.stage,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        duration_ms: Number(result?.usage?.duration_ms) || Date.now() - started,
        secret_hits: 0,
        secret_rewrites: 0,
      };
      onUsage?.(record);
      const guard = budgetGuard.record(usage);
      if (guard.triggered) onBudgetWarning?.(guard.warning);
      return { ...result, usage: { ...usage, cost_yuan: usageCost(usage) } };
    },
  };
}

/**
 * 纯编排：给定上下文，推进一天。不触网的部分与前端 day.js 保持一致。
 */
export async function runTick({
  townId,
  dayIndex,
  context,
  event,
  model,
  emit,
  onUsage,
  maxDialogueRounds,
  budgetYuan,
  prices,
  warnings = [],
}) {
  for (const warning of warnings) emit('warning', warning);
  if (event) {
    context = {
      ...context,
      day_state: { ...context.day_state, user_event: event },
    };
  }

  const machine = new TickMachine('idle');
  const agents = context.agents;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const secrets = agents.map((agent) => agent.secret);
  const town = { ...context.town, id: townId };
  const usageRecords = [];

  let degraded = false;
  let roundsLimit = Math.min(
    LIMITS.MAX_DIALOGUE_ROUNDS,
    Number(maxDialogueRounds ?? context.limits?.max_dialogue_rounds ?? LIMITS.MAX_DIALOGUE_ROUNDS)
  );
  let budgetNotified = false;

  const budgetGuard = createBudgetGuard({ budgetYuan, prices });
  const metered = createMeteredModel(model, {
    townId,
    day: dayIndex,
    onUsage: (record) => {
      usageRecords.push(record);
      onUsage?.(record);
    },
    budgetGuard,
    onBudgetWarning: (warning) => {
      if (budgetNotified) return;
      budgetNotified = true;
      // 降级策略：减少对话轮次 + 压缩当日事件层，然后继续
      roundsLimit = Math.min(roundsLimit, 4);
      for (const agent of agents) {
        if (agent.memories) agent.memories.today_events = [];
      }
      emit('warning', warning);
    },
  });

  machine.to('validating');
  machine.to('planning');

  const plans = await generatePlans({
    model: metered,
    town,
    agents,
    day: dayIndex,
    context,
    onWarning: (warning) => {
      degraded = true;
      emit('warning', warning);
    },
  });
  for (const entry of plans) {
    if (entry.degraded) degraded = true;
    emit('planning', { agent_id: entry.agent_id, plan: entry.plan });
  }

  machine.to('simulating');

  const { encounters } = collectEncounters({ agents, plans });
  const dialogues = [];

  for (const encounter of encounters) {
    const initiator = agentById.get(encounter.participant_ids[0]);
    const partner = agentById.get(encounter.participant_ids[1]);
    if (!initiator || !partner) continue;
    try {
      const dialogue = await generateDialogue({
        model: metered,
        town,
        encounter,
        initiator,
        partner,
        day: dayIndex,
        context: {
          ...context,
          limits: { ...context.limits, max_dialogue_rounds: roundsLimit },
        },
      });
      const guarded = await guardDialogue({ dialogue, secrets });
      if (guarded.usage.secret_hits > 0) {
        const record = {
          town_id: townId,
          day: dayIndex,
          stage: 'dialogue',
          input_tokens: 0,
          output_tokens: 0,
          duration_ms: 0,
          secret_hits: guarded.usage.secret_hits,
          secret_rewrites: guarded.usage.secret_rewrites,
        };
        usageRecords.push(record);
        onUsage?.(record);
      }
      dialogues.push(guarded.dialogue);
      emit('dialogue', {
        location: guarded.dialogue.location,
        hour: guarded.dialogue.hour,
        participants: guarded.dialogue.participant_ids,
        rounds: guarded.dialogue.transcript,
      });
    } catch {
      degraded = true;
      emit(
        'warning',
        createWarning(
          WARNING_CODES.W_STAGE_DEGRADED,
          `${initiator.name}和${partner.name}的对话生成失败，已跳过`
        )
      );
    }
  }

  machine.to('reflecting');

  const unsayResults = await Promise.allSettled(
    agents.map((agent) => generateUnsay({ model: metered, town, agent, day: dayIndex, context }))
  );
  const unsays = [];
  unsayResults.forEach((result, index) => {
    const agent = agents[index];
    if (result.status !== 'fulfilled') {
      degraded = true;
      emit(
        'warning',
        createWarning(WARNING_CODES.W_STAGE_DEGRADED, `${agent.name}的独白生成失败，已跳过`)
      );
      return;
    }
    unsays.push({ agent_id: agent.id, agent_name: agent.name, text: result.value });
  });

  for (const unsay of unsays) {
    const guarded = await guardText({ text: unsay.text, secrets });
    unsay.text = guarded.text;
    if (guarded.usage.secret_hits > 0) {
      const record = {
        town_id: townId,
        day: dayIndex,
        stage: 'unsay',
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: 0,
        secret_hits: guarded.usage.secret_hits,
        secret_rewrites: guarded.usage.secret_rewrites,
      };
      usageRecords.push(record);
      onUsage?.(record);
    }
    emit('unsaid', { agent_id: unsay.agent_id, text: unsay.text });
  }

  const ensured = await ensureUnsays({
    agents,
    unsays,
    regenerate: async (agent) => {
      const text = await generateUnsay({ model: metered, town, agent, day: dayIndex, context });
      const guarded = await guardText({ text, secrets });
      return guarded.text;
    },
  });
  if (ensured.degraded) {
    degraded = true;
    emit('warning', createWarning(WARNING_CODES.W_REPORT_PARTIAL));
  }
  for (const unsay of ensured.unsays) {
    if (!unsays.some((item) => item.agent_id === unsay.agent_id)) {
      emit('unsaid', { agent_id: unsay.agent_id, text: unsay.text });
    }
  }

  if (degraded) machine.to('degraded');
  machine.to('reporting');

  const relationUpdates = planRelationUpdates({
    townId,
    relations: context.relations ?? [],
    dialogues,
    day: dayIndex,
  });

  const report = buildReport({
    town,
    day: dayIndex,
    agents,
    unsays: ensured.unsays,
    dialogues,
    previousRelations: context.relations ?? [],
    relationUpdates,
    generationMode: degraded ? 'degraded' : 'normal',
  });

  emit('report_ready', { report });

  machine.to('done');
  const usage = summarizeUsage(usageRecords, prices);
  emit('done', { day_index: dayIndex, usage });

  return {
    state: machine.state,
    stages: machine.history,
    plans,
    dialogues,
    unsays: ensured.unsays,
    report,
    usage,
    usageRecords,
    warnings: [],
  };
}

function createReplayStream(frames) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(encodeFrame(frame.id, frame.event, frame.data)));
      }
      controller.close();
    },
  });
}

/** 续传：只重放快照里 id 大于 Last-Event-ID 的帧，不重跑模型 */
function createResumeStream({ snapshot, lastEventId, townId, dayIndex, rkv, timeoutMs }) {
  const encoder = new TextEncoder();
  let emitted = lastEventId;
  let finished = false;

  return new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + timeoutMs;
      const send = (frame) => {
        if (finished || frame.id <= emitted) return;
        emitted = frame.id;
        controller.enqueue(encoder.encode(encodeFrame(frame.id, frame.event, frame.data)));
      };

      try {
        for (const frame of snapshot.frames ?? []) send(frame);
        let current = snapshot;

        while (!current.done) {
          if (Date.now() > deadline) {
            controller.enqueue(
              encoder.encode(
                errorFrame(emitted + 1, ERROR_CODES.E_MODEL_TIMEOUT, '续传等待超时')
              )
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_POLL_MS));
          current = (await rkv.getSnapshot(townId, dayIndex)) ?? current;
          for (const frame of current.frames ?? []) send(frame);
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(errorFrame(emitted + 1, err?.code ?? ERROR_CODES.E_INTERNAL, err?.message))
        );
      } finally {
        finished = true;
        controller.close();
      }
    },
    cancel() {
      finished = true;
    },
  });
}

function createTickStream({
  tickId: currentTickId,
  townId,
  dayIndex,
  context,
  event,
  model,
  rkv,
  idemKey,
  timeoutMs,
  budgetYuan,
  prices,
  warnings,
  onUsage,
}) {
  const encoder = new TextEncoder();
  const frames = [];
  let lastId = 0;
  let closed = false;
  let finished = false;
  let saveChain = Promise.resolve();
  let heartbeat = null;
  let deadline = null;
  let controllerRef = null;

  const snapshot = {
    tick_id: currentTickId,
    town_id: townId,
    day_index: dayIndex,
    frames,
    done: false,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  function scheduleSave() {
    snapshot.updated_at = Date.now();
    snapshot.frames = frames.slice();
    saveChain = saveChain
      .then(() => rkv.saveSnapshot(townId, dayIndex, snapshot))
      .catch(() => {});
  }

  function emit(eventName, data) {
    if (closed) return;
    lastId += 1;
    frames.push({ id: lastId, event: eventName, data });
    try {
      controllerRef.enqueue(encoder.encode(encodeFrame(lastId, eventName, data)));
    } catch {
      closed = true;
    }
    scheduleSave();
  }

  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    await saveChain;
    snapshot.done = true;
    snapshot.frames = frames.slice();
    await rkv.saveSnapshot(townId, dayIndex, snapshot);
    if (idemKey) {
      await rkv.putIdempotent(townId, idemKey, {
        tick_id: currentTickId,
        town_id: townId,
        day_index: dayIndex,
        done: true,
        frames: frames.slice(),
      });
    }
    await rkv.releaseTick(townId, currentTickId);
    closed = true;
    try {
      controllerRef.close();
    } catch {
      /* 已关闭 */
    }
  }

  return new ReadableStream({
    start(controller) {
      controllerRef = controller;
      emit('accepted', { tick_id: currentTickId });

      heartbeat = setInterval(() => {
        if (finished || closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, LIMITS.SSE_HEARTBEAT_MS);

      deadline = setTimeout(() => {
        if (finished) return;
        emit('error', {
          code: ERROR_CODES.E_MODEL_TIMEOUT,
          message: '推进超时，已完成阶段已保存，可稍后续传',
          retryable: true,
        });
        finish();
      }, timeoutMs);

      (async () => {
        try {
          await runTick({
            townId,
            dayIndex,
            context,
            event,
            model,
            emit,
            onUsage,
            budgetYuan,
            prices,
            warnings,
          });
        } catch (err) {
          const code = Object.hasOwn(ERROR_CODES, err?.code)
            ? err.code
            : ERROR_CODES.E_INTERNAL;
          emit('error', {
            code,
            message: err?.message ?? '推进失败',
            retryable: ERROR_RETRYABLE[code] ?? false,
          });
        } finally {
          await finish();
        }
      })();
    },
    cancel() {
      // 客户端断流不取消服务端推进：让它把快照补完，供 Last-Event-ID 续传
      closed = true;
      clearInterval(heartbeat);
    },
  });
}

export default async function handler(options = {}) {
  const {
    method,
    path,
    headers,
    body,
    kv,
    env = globalThis.process?.env ?? {},
    fetchImpl = globalThis.fetch,
    model: injectedModel,
    onUsage,
    now,
    tickTimeoutMs = DEFAULT_TICK_TIMEOUT_MS,
    budgetYuan,
    prices,
  } = options;

  const trace = traceId();
  const townId = resolveTownId(path, options.townId);

  if (method !== 'POST') {
    return errorResult(ERROR_CODES.E_VALIDATION, 'tick 只支持 POST', { traceId: trace });
  }
  if (!townId) {
    return errorResult(ERROR_CODES.E_VALIDATION, '缺少小镇 id', { traceId: trace });
  }

  const session = getSession(headers);
  if (!session) {
    return errorResult(ERROR_CODES.E_NO_SESSION, undefined, { traceId: trace });
  }

  if (payloadBytes(body) > LIMITS.MAX_PAYLOAD_BYTES) {
    return errorResult(ERROR_CODES.E_PAYLOAD_TOO_LARGE, 'tick 请求体超过 256KB', {
      traceId: trace,
    });
  }
  if (!body || typeof body !== 'object') {
    return errorResult(ERROR_CODES.E_VALIDATION, 'tick 请求体必须是对象', { traceId: trace });
  }

  const dayIndex = body.day_index;
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > LIMITS.DAYS_PER_TOWN) {
    return errorResult(ERROR_CODES.E_TOWN_STATE, `day_index 必须在 1–${LIMITS.DAYS_PER_TOWN} 之间`, {
      traceId: trace,
    });
  }
  if (!body.context || typeof body.context !== 'object') {
    return errorResult(ERROR_CODES.E_VALIDATION, '缺少 tick 上下文', { traceId: trace });
  }
  if (body.context.town?.id !== townId) {
    return errorResult(ERROR_CODES.E_TOWN_STATE, '上下文的小镇 id 与路径不一致', {
      traceId: trace,
    });
  }

  let validated;
  try {
    validated = validateTickContext(body.context, { dayIndex });
  } catch (err) {
    return toErrorResult(err, trace);
  }

  let event = null;
  if (body.event !== undefined && body.event !== null) {
    try {
      event = validateEventInput(body.event);
    } catch (err) {
      return toErrorResult(err, trace);
    }
  }

  const rkv = createRuntimeKV(kv ?? createMemoryKV(), { now });
  const lastEventId = Number(headerValue(headers, 'last-event-id') ?? 0);
  const resuming = Number.isFinite(lastEventId) && lastEventId > 0;

  if (resuming) {
    const snapshot = await rkv.getSnapshot(townId, dayIndex);
    if (!snapshot) {
      return errorResult(ERROR_CODES.E_TOWN_STATE, '没有可续传的推进快照', { traceId: trace });
    }
    return {
      status: 200,
      headers: SSE_HEADERS,
      stream: createResumeStream({
        snapshot,
        lastEventId,
        townId,
        dayIndex,
        rkv,
        timeoutMs: tickTimeoutMs,
      }),
    };
  }

  const rate = await rkv.rateLimit(session.token);
  if (!rate.allowed) {
    return errorResult(ERROR_CODES.E_RATE_LIMIT, undefined, {
      traceId: trace,
      headers: rateLimitHeaders(rate),
    });
  }

  const idemKey = headerValue(headers, 'idempotency-key');
  if (idemKey) {
    const cached = await rkv.getIdempotent(townId, idemKey);
    if (cached?.done) {
      return {
        status: 200,
        headers: SSE_HEADERS,
        stream: createReplayStream(cached.frames ?? []),
      };
    }
  }

  const currentTickId = tickId();
  const acquired = await rkv.acquireTick(townId, currentTickId);
  if (!acquired) {
    return errorResult(ERROR_CODES.E_TICK_IN_FLIGHT, undefined, { traceId: trace });
  }

  let model;
  try {
    model = injectedModel ?? resolveModel({ env, session, fetchImpl });
  } catch (err) {
    await rkv.releaseTick(townId, currentTickId);
    return toErrorResult(err, trace);
  }

  return {
    status: 200,
    headers: SSE_HEADERS,
    stream: createTickStream({
      tickId: currentTickId,
      townId,
      dayIndex,
      context: validated.context,
      event,
      model,
      rkv,
      idemKey,
      timeoutMs: tickTimeoutMs,
      budgetYuan,
      prices,
      warnings: validated.warnings,
      onUsage,
    }),
  };
}
