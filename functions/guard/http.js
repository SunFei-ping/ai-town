/**
 * 服务端 HTTP 与 SSE 的公共输出，见 SPCD §7.1 / §7.6。
 */
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  ERROR_MESSAGES,
  toErrorBody,
} from '../../shared/errors/codes.js';

export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

export const SSE_HEADERS = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
});

export function errorResult(code, message, { traceId = '', headers = {} } = {}) {
  const finalCode = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.E_INTERNAL;
  // AppError 在没有显式 message 时会把 code 当作 message，这里回退到中文默认提示
  const finalMessage =
    typeof message === 'string' && message.trim() && message !== finalCode ? message : undefined;
  return {
    status: ERROR_HTTP_STATUS[finalCode] ?? 500,
    headers: { ...JSON_HEADERS, ...headers },
    body: toErrorBody(finalCode, finalMessage, traceId),
  };
}

export function toErrorResult(err, traceId = '') {
  const code = Object.hasOwn(ERROR_CODES, err?.code) ? err.code : ERROR_CODES.E_INTERNAL;
  const message =
    typeof err?.message === 'string' && err.message !== code ? err.message : undefined;
  return errorResult(code, message, { traceId });
}

/** 限流响应头，见 SPCD §7.1 */
export function rateLimitHeaders(rate) {
  return {
    'X-RateLimit-Limit': String(rate.limit),
    'X-RateLimit-Remaining': String(rate.remaining),
    'X-RateLimit-Reset': String(rate.resetAt),
  };
}

/** SSE 帧：event / id / data，见 SPCD §7.6 */
export function encodeFrame(id, event, data) {
  return `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
}

/** 错误帧；发送后流应关闭 */
export function errorFrame(id, code, message) {
  const finalCode = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.E_INTERNAL;
  return encodeFrame(id, 'error', {
    code: finalCode,
    message: message ?? ERROR_MESSAGES[finalCode],
    retryable: ERROR_RETRYABLE[finalCode] ?? false,
  });
}

/** 请求头大小写不敏感读取 */
export function headerValue(headers, name) {
  if (!headers) return undefined;
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}
