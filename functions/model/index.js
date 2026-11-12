/**
 * 模型适配层，见 task.md M5-01 与 SPCD §7.3 / §8.3。
 *
 * 职责：
 * - 封装 OpenAI 兼容的 /chat/completions 调用
 * - 统一超时、重试、结构化解析与日志脱敏
 * - 所有失败都映射为 SPCD §7.5 的错误码
 *
 * 约束：api_key 只允许出现在请求头里；任何日志字段都必须先经过 redactLogValue。
 */
import { fail } from '../../shared/errors/app-error.js';
import { ERROR_CODES, ERROR_RETRYABLE } from '../../shared/errors/codes.js';

export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_RETRIES = 1;
/** 初始单价（元 / 千 token），实测后按 §12.4 调整 */
export const DEFAULT_PRICES = Object.freeze({
  input_per_1k: 0.001,
  output_per_1k: 0.002,
});

/** 日志里的 Key 永远是脱敏值 */
export function maskApiKey(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 3)}***${text.slice(-4)}`;
}

/** 递归脱敏：api_key / authorization / secret / token 一类字段不落原文 */
export function redactLogValue(value) {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|authorization|secret|token/i.test(key)) {
        result[key] = maskApiKey(item);
      } else {
        result[key] = redactLogValue(item);
      }
    }
    return result;
  }
  return value;
}

/** 带脱敏的 JSON 日志器 */
export function createRedactedLogger(sink = console) {
  return {
    info(entry) {
      const write = sink?.info ?? sink?.log;
      if (typeof write === 'function') write.call(sink, JSON.stringify(redactLogValue(entry)));
    },
  };
}

/**
 * 从模型输出中抽取 JSON。
 * 允许 Markdown 代码围栏与前后多余文本；仍解析失败则 E_MODEL_OUTPUT。
 */
export function extractJson(content) {
  if (content && typeof content === 'object') return content;
  const raw = String(content ?? '').trim();
  if (!raw) fail(ERROR_CODES.E_MODEL_OUTPUT, '模型返回为空');

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  const body = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* 落到下面统一报错 */
      }
    }
    fail(ERROR_CODES.E_MODEL_OUTPUT, '模型返回的内容不是合法 JSON');
  }
  return null;
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(JSON.stringify(value ?? '').length / 2));
}

/** 统一用量结构；上游未返回用量时按字符数估算 */
export function normalizeUsage(raw, { prompt, output } = {}) {
  const input = Number(raw?.prompt_tokens ?? raw?.input_tokens ?? 0);
  const outputTokens = Number(raw?.completion_tokens ?? raw?.output_tokens ?? 0);
  const inputTokens = input > 0 ? input : estimateTokens(prompt);
  const finalOutput = outputTokens > 0 ? outputTokens : estimateTokens(output);
  return {
    input_tokens: inputTokens,
    output_tokens: finalOutput,
    total_tokens:
      Number(raw?.total_tokens) > 0 ? Number(raw.total_tokens) : inputTokens + finalOutput,
  };
}

/** 元 / 千 token 折算 */
export function usageCost(usage, prices = DEFAULT_PRICES) {
  const input = Number(usage?.input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  return (
    (input / 1000) * Number(prices.input_per_1k ?? 0) +
    (output / 1000) * Number(prices.output_per_1k ?? 0)
  );
}

/** 没有 usage 的模型（桩模型）也能量化用量 */
export function estimateUsage(input, output) {
  return {
    input_tokens: estimateTokens(input),
    output_tokens: estimateTokens(output),
    total_tokens: estimateTokens(input) + estimateTokens(output),
  };
}

function profileOf(agent) {
  if (!agent) return null;
  return {
    name: agent.name,
    age: agent.age,
    occupation: agent.occupation,
    persona: agent.persona,
    secret: agent.secret,
    conflict_goal: agent.conflict_goal,
    speech_style: agent.speech_style,
  };
}

/** 每个阶段的结构约束都写在提示里，减少 E_MODEL_OUTPUT */
export function buildMessages(input) {
  const { stage, agent, agents, town, day, hour, location, context } = input;
  const maxRounds = context?.limits?.max_dialogue_rounds ?? 6;
  const base = {
    day,
    hour,
    location,
    town: town ? { name: town.name, day_index: town.day_index } : undefined,
    weather: context?.day_state?.weather ?? '',
    user_event: context?.day_state?.user_event ?? null,
  };

  const system =
    '你是《AI小镇》的叙事引擎。只输出一个合法 JSON 对象，不要 Markdown 代码围栏，不要解释。' +
    '用简体中文，内容具体、克制、有生活质感。不得直接复述任何居民的 secret 原文。';

  if (stage === 'plan') {
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `为居民生成一天的安排。\n` +
          `居民：${JSON.stringify(profileOf(agent))}\n` +
          `背景：${JSON.stringify({ ...base, relations: context?.relations ?? [] })}\n` +
          `记忆：${JSON.stringify(agent?.memories ?? {})}\n` +
          '要求：3–6 个时间段，hour 取 6–22 的整数，location 为具体地点，intent 一句话。\n' +
          '输出结构：{"plan":[{"hour":7,"location":"五金店","intent":"开门营业"}]}',
      },
    ];
  }

  if (stage === 'dialogue') {
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `写一段两个居民在${location ?? '同一地点'}的对话。\n` +
          `参与者：${JSON.stringify((agents ?? [agent]).map(profileOf))}\n` +
          `背景：${JSON.stringify(base)}\n` +
          `要求：最多 ${maxRounds} 轮，每轮说话人必须是参与者姓名；不要寒暄开场；允许沉默与分歧。\n` +
          '输出结构：{"rounds":[{"speaker":"姓名","content":"台词"}],"disagreement":false}',
      },
    ];
  }

  if (stage === 'unsay') {
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `写一句${agent?.name ?? '居民'}今天没说出口的话，120 字以内，要具体，不要总结。\n` +
          `居民：${JSON.stringify(profileOf(agent))}\n` +
          `背景：${JSON.stringify({ ...base, memories: agent?.memories ?? {} })}\n` +
          '输出结构：{"text":"一句话"}',
      },
    ];
  }

  fail(ERROR_CODES.E_VALIDATION, `模型适配层不支持的阶段：${stage}`);
  return [];
}

function chatUrl(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

function modelsUrl(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  return `${base}/models`;
}

function toAppError(err) {
  if (err?.code) return err;
  if (err?.name === 'AbortError' || /abort|timeout/i.test(String(err?.message ?? ''))) {
    return Object.assign(new Error('模型响应超时'), { code: ERROR_CODES.E_MODEL_TIMEOUT });
  }
  return Object.assign(new Error(err?.message ?? '模型调用失败'), { code: ERROR_CODES.E_INTERNAL });
}

function httpError(status) {
  if (status === 401 || status === 403) {
    return Object.assign(new Error('API Key 无效或没有权限'), { code: ERROR_CODES.E_KEY_INVALID });
  }
  if (status === 402) {
    return Object.assign(new Error('API Key 额度不足'), { code: ERROR_CODES.E_QUOTA_EXCEEDED });
  }
  if (status === 429) {
    return Object.assign(new Error('模型服务限流'), { code: ERROR_CODES.E_RATE_LIMIT });
  }
  return Object.assign(new Error(`模型服务返回 ${status}`), { code: ERROR_CODES.E_INTERNAL });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 创建模型适配器。
 * 所有网络失败都会在 retries 次后抛出带 code 的 AppError。
 */
export function createModelAdapter({
  baseUrl,
  modelName = 'gpt-4o-mini',
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  fetchImpl = globalThis.fetch,
  logger = null,
  temperature = 0.8,
} = {}) {
  if (!baseUrl) fail(ERROR_CODES.E_INTERNAL, '模型服务地址未配置');
  if (typeof fetchImpl !== 'function') fail(ERROR_CODES.E_INTERNAL, '运行时缺少 fetch');

  const url = chatUrl(baseUrl);

  async function callOnce(input) {
    const messages = buildMessages(input);
    const started = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey ?? ''}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelName,
              temperature,
              messages,
              response_format: { type: 'json_object' },
            }),
          },
          timeoutMs
        );

        if (!res.ok) {
          throw httpError(res.status);
        }

        let payload;
        try {
          payload = await res.json();
        } catch {
          fail(ERROR_CODES.E_MODEL_OUTPUT, '模型响应不是合法 JSON');
        }

        const content = payload?.choices?.[0]?.message?.content;
        const parsed = extractJson(content);
        const usage = normalizeUsage(payload?.usage, {
          prompt: messages,
          output: content,
        });

        logger?.info(
          redactLogValue({
            stage: input.stage,
            attempt,
            model: modelName,
            api_key: apiKey,
            duration_ms: Date.now() - started,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
          })
        );

        return { ...parsed, usage };
      } catch (err) {
        lastError = toAppError(err);
        if (!ERROR_RETRYABLE[lastError.code] || attempt >= retries) break;
        await sleep(Math.min(1000, 50 * 2 ** attempt));
      }
    }

    logger?.info(
      redactLogValue({
        stage: input.stage,
        attempt: 'failed',
        model: modelName,
        api_key: apiKey,
        error_code: lastError?.code,
        duration_ms: Date.now() - started,
      })
    );
    throw lastError;
  }

  return {
    complete(input) {
      return callOnce(input);
    },
  };
}

/**
 * 真实校验 Key：GET /models。
 * 401/403 → E_KEY_INVALID；402 → E_QUOTA_EXCEEDED；超时 → E_MODEL_TIMEOUT。
 */
export async function verifyApiKey({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (!baseUrl) fail(ERROR_CODES.E_INTERNAL, '模型服务地址未配置');
  if (typeof fetchImpl !== 'function') fail(ERROR_CODES.E_INTERNAL, '运行时缺少 fetch');

  let res;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      modelsUrl(baseUrl),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      },
      timeoutMs
    );
  } catch (err) {
    throw toAppError(err);
  }

  if (res.status === 401 || res.status === 403) {
    fail(ERROR_CODES.E_KEY_INVALID);
  }
  if (res.status === 402) {
    fail(ERROR_CODES.E_QUOTA_EXCEEDED);
  }
  if (!res.ok) {
    fail(ERROR_CODES.E_INTERNAL, `模型服务返回 ${res.status}`);
  }
  return true;
}
