/**
 * SSE 客户端，见 SPCD §7.1 / §7.6。
 *
 * 必须使用 fetch + ReadableStream 消费流式响应：
 * 浏览器原生 EventSource 不能携带 Authorization 头，本项目明确禁用。
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

/** 增量解析 SSE：支持注释心跳帧（": ping"）与多行 data */
export function createSSEParser() {
  let buffer = '';

  function parseBlock(block) {
    let id = null;
    let event = null;
    const dataLines = [];

    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = Number(value);
      else if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }

    if (!event) return null;
    let data = {};
    if (dataLines.length > 0) {
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        data = { raw: dataLines.join('\n') };
      }
    }
    return { id: Number.isFinite(id) ? id : null, event, data };
  }

  return {
    push(chunk) {
      buffer += String(chunk ?? '').replace(/\r\n/g, '\n');
      const frames = [];
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const frame = parseBlock(block);
        if (frame) frames.push(frame);
        index = buffer.indexOf('\n\n');
      }
      return frames;
    },
    flush() {
      if (!buffer.trim()) return [];
      const frame = parseBlock(buffer);
      buffer = '';
      return frame ? [frame] : [];
    },
  };
}

function errorFromResponse(payload) {
  const error = payload?.error;
  return new AppError(
    error?.code ?? ERROR_CODES.E_INTERNAL,
    error?.message ?? '推进失败',
    payload
  );
}

/**
 * 发起一次 tick 并读取 SSE。
 *
 * @param {object} options
 * @param {string} options.townId
 * @param {number} options.dayIndex
 * @param {object} options.context
 * @param {object} [options.event]
 * @param {string} options.sessionToken
 * @param {number} [options.lastEventId]
 * @param {string} [options.idempotencyKey]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.fetchImpl]
 * @param {(frame: object) => void} [options.onFrame]
 * @returns {Promise<{frames: Array, usage: object|null}>}
 */
export async function streamTick({
  townId,
  dayIndex,
  context,
  event,
  sessionToken,
  lastEventId,
  idempotencyKey,
  signal,
  fetchImpl = globalThis.fetch,
  onFrame,
}) {
  const headers = {
    Authorization: `Bearer ${sessionToken ?? ''}`,
    'Content-Type': 'application/json',
  };
  if (lastEventId) headers['Last-Event-ID'] = String(lastEventId);
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const body = { day_index: dayIndex, context };
  if (event) body.event = event;

  const res = await fetchImpl(`/v1/towns/${encodeURIComponent(townId)}/tick`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw errorFromResponse(payload);
  }
  if (!res.body) {
    throw new AppError(ERROR_CODES.E_INTERNAL, '响应没有可读取的流');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  const frames = [];
  let usage = null;

  function collect(next) {
    for (const frame of next) {
      frames.push(frame);
      onFrame?.(frame);
      if (frame.event === 'done' && frame.data?.usage) usage = frame.data.usage;
      if (frame.event === 'error') {
        throw new AppError(
          frame.data?.code ?? ERROR_CODES.E_INTERNAL,
          frame.data?.message ?? '推进失败',
          frame.data
        );
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      collect(parser.push(decoder.decode(value, { stream: true })));
    }
    collect(parser.push(decoder.decode()));
    collect(parser.flush());
  } finally {
    reader.releaseLock?.();
  }

  return { frames, usage };
}
