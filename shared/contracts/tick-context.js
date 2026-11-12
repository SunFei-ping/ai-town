/**
 * Tick 上下文契约，对应 SPCD §7.3。
 * K1–K6 是前后端唯一的耦合校验，服务端与前端共用本文件。
 */
import { fail } from '../errors/app-error.js';
import { ERROR_CODES, WARNING_CODES, WARNING_MESSAGES } from '../errors/codes.js';
import { LIMITS } from './index.js';

/** 粗略 token 估算：按序列化长度的 1/2 计，用于截断判断 */
export function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value ?? '').length / 2);
}

/** 请求体的 UTF-8 字节数（K6） */
export function payloadBytes(value) {
  const json = JSON.stringify(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  return json.length * 2;
}

/**
 * 校验并必要时收敛上下文：
 * - K1 agents 必须 5 人
 * - K2 day_index 与 town.day_index 一致
 * - K3 每人至少 1 条 summary（第 1 天可为空）
 * - K4 relations 两端都在 agents 中
 * - K5 客户端 max_context_tokens 高于服务端时取较小值，发 W_LIMIT_CLAMPED
 * - K6 整体不超过 256KB
 *
 * @returns {{ context: object, warnings: Array<{code: string, message: string}> }}
 */
export function validateTickContext(context, { dayIndex } = {}) {
  if (!context || typeof context !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, 'tick 上下文必须是对象');
  }

  // K1
  if (!Array.isArray(context.agents) || context.agents.length !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `tick 上下文必须包含恰好 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }

  // K2
  const townDay = context.town?.day_index;
  if (dayIndex !== undefined && townDay !== dayIndex) {
    fail(ERROR_CODES.E_TOWN_STATE, `day_index 与 town.day_index 不一致：${dayIndex} ≠ ${townDay}`);
  }

  // K3
  if (townDay > 1) {
    for (const agent of context.agents) {
      const summaries = agent?.memories?.summaries;
      if (!Array.isArray(summaries) || summaries.length === 0) {
        fail(ERROR_CODES.E_VALIDATION, `${agent?.name ?? '居民'}缺少总结层记忆`);
      }
    }
  }

  // K4
  const agentIds = new Set(context.agents.map((agent) => agent?.id));
  for (const relation of context.relations ?? []) {
    if (!agentIds.has(relation?.from_agent_id) || !agentIds.has(relation?.to_agent_id)) {
      fail(ERROR_CODES.E_VALIDATION, '关系两端的居民必须都在 agents 中');
    }
  }

  // K5
  const warnings = [];
  let next = context;
  const requested = context.limits?.max_context_tokens;
  if (typeof requested === 'number' && requested > LIMITS.CTX_TOKEN_LIMIT) {
    next = {
      ...context,
      limits: { ...context.limits, max_context_tokens: LIMITS.CTX_TOKEN_LIMIT },
    };
    warnings.push({
      code: WARNING_CODES.W_LIMIT_CLAMPED,
      message: WARNING_MESSAGES.W_LIMIT_CLAMPED,
    });
  }

  // K6
  if (payloadBytes(next) > LIMITS.MAX_PAYLOAD_BYTES) {
    fail(ERROR_CODES.E_PAYLOAD_TOO_LARGE, 'tick 上下文超过 256KB');
  }

  return { context: next, warnings };
}
