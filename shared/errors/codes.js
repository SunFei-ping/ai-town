/**
 * SPCD §7.5 错误码与告警码的唯一事实源。
 * 任何新增码必须先改 docs/spcd.md §7.5，再改这里。
 */

export const ERROR_CODES = Object.freeze({
  E_NO_SESSION: 'E_NO_SESSION',
  E_KEY_INVALID: 'E_KEY_INVALID',
  E_QUOTA_EXCEEDED: 'E_QUOTA_EXCEEDED',
  E_RATE_LIMIT: 'E_RATE_LIMIT',
  E_TICK_IN_FLIGHT: 'E_TICK_IN_FLIGHT',
  E_MODEL_TIMEOUT: 'E_MODEL_TIMEOUT',
  E_MODEL_OUTPUT: 'E_MODEL_OUTPUT',
  E_TOWN_STATE: 'E_TOWN_STATE',
  E_VALIDATION: 'E_VALIDATION',
  E_PAYLOAD_TOO_LARGE: 'E_PAYLOAD_TOO_LARGE',
  E_CONTENT_BLOCKED: 'E_CONTENT_BLOCKED',
  E_INTERNAL: 'E_INTERNAL',
});

export const ERROR_HTTP_STATUS = Object.freeze({
  E_NO_SESSION: 401,
  E_KEY_INVALID: 401,
  E_QUOTA_EXCEEDED: 402,
  E_RATE_LIMIT: 429,
  E_TICK_IN_FLIGHT: 409,
  E_MODEL_TIMEOUT: 504,
  E_MODEL_OUTPUT: 502,
  E_TOWN_STATE: 409,
  E_VALIDATION: 400,
  E_PAYLOAD_TOO_LARGE: 413,
  E_CONTENT_BLOCKED: 422,
  E_INTERNAL: 500,
});

export const ERROR_RETRYABLE = Object.freeze({
  E_NO_SESSION: false,
  E_KEY_INVALID: false,
  E_QUOTA_EXCEEDED: false,
  E_RATE_LIMIT: true,
  E_TICK_IN_FLIGHT: false,
  E_MODEL_TIMEOUT: true,
  E_MODEL_OUTPUT: true,
  E_TOWN_STATE: false,
  E_VALIDATION: false,
  E_PAYLOAD_TOO_LARGE: false,
  E_CONTENT_BLOCKED: false,
  E_INTERNAL: true,
});

export const ERROR_MESSAGES = Object.freeze({
  E_NO_SESSION: '会话已失效，请重新填入 API Key',
  E_KEY_INVALID: 'API Key 无效或没有权限，请检查后重试',
  E_QUOTA_EXCEEDED: 'API Key 额度不足',
  E_RATE_LIMIT: '操作过于频繁，请稍后再试',
  E_TICK_IN_FLIGHT: '这一天正在推进中，请等待完成',
  E_MODEL_TIMEOUT: '模型响应超时',
  E_MODEL_OUTPUT: '模型返回的内容格式不正确',
  E_TOWN_STATE: '小镇当前状态不支持该操作',
  E_VALIDATION: '提交的内容不合法',
  E_PAYLOAD_TOO_LARGE: '提交的内容过大',
  E_CONTENT_BLOCKED: '提交的内容未通过安全校验',
  E_INTERNAL: '服务出现异常，请稍后重试',
});

export const WARNING_CODES = Object.freeze({
  W_BUDGET_GUARD: 'W_BUDGET_GUARD',
  W_LIMIT_CLAMPED: 'W_LIMIT_CLAMPED',
  W_STAGE_DEGRADED: 'W_STAGE_DEGRADED',
  W_REPORT_PARTIAL: 'W_REPORT_PARTIAL',
  W_BACKFILL_CAPPED: 'W_BACKFILL_CAPPED',
});

export const WARNING_MESSAGES = Object.freeze({
  W_BUDGET_GUARD: '本次推进接近成本上限，已自动降低生成强度',
  W_LIMIT_CLAMPED: '部分参数已按服务端上限执行',
  W_STAGE_DEGRADED: '某一步生成失败，已跳过并继续',
  W_REPORT_PARTIAL: '本日小报为兜底生成，内容可能不完整',
  W_BACKFILL_CAPPED: '一次性补算天数已达上限，剩余天数可稍后继续',
});

/**
 * 统一的错误响应体，形状见 SPCD §7.1。
 */
export function toErrorBody(code, message, traceId) {
  return {
    error: {
      code,
      message: message ?? ERROR_MESSAGES[code] ?? '未知错误',
      retryable: ERROR_RETRYABLE[code] ?? false,
      trace_id: traceId ?? '',
    },
  };
}
