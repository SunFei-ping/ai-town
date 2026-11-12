import { describe, it, expect } from 'vitest';
import {
  buildMessages,
  createModelAdapter,
  createRedactedLogger,
  extractJson,
  maskApiKey,
  verifyApiKey,
} from '../../functions/model/index.js';

const API_KEY = 'sk-live-secret-value-1234567890';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(content, usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return jsonResponse({ choices: [{ message: { content } }], usage });
}

function planInput() {
  return {
    stage: 'plan',
    agent: { name: '陈望', occupation: '五金店老板' },
    town: { name: '测试镇', day_index: 1 },
    day: 1,
    context: { limits: { max_dialogue_rounds: 6 }, relations: [] },
  };
}

describe('模型适配层（model-adapter）', () => {
  it('解析结构化输出并归一化用量', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      fetchImpl: async () =>
        completion('{"plan":[{"hour":7,"location":"五金店","intent":"开门"}]}'),
    });

    const result = await adapter.complete(planInput());

    expect(result.plan).toHaveLength(1);
    expect(result.plan[0].location).toBe('五金店');
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(120);
  });

  it('允许 Markdown 代码围栏', () => {
    const parsed = extractJson('```json\n{"text":"一句话"}\n```');
    expect(parsed.text).toBe('一句话');
  });

  it('计划提示包含公共地点与其他居民，减少各写各的', () => {
    const messages = buildMessages({
      stage: 'plan',
      agent: { name: '陈望', occupation: '五金店老板' },
      context: {
        agents: [
          { name: '陈望', occupation: '五金店老板' },
          { name: '林小满', occupation: '咖啡店老板' },
        ],
        relations: [],
        limits: { max_dialogue_rounds: 6 },
      },
      day: 1,
      town: { name: '测试镇', day_index: 1 },
    });
    const text = messages.map((message) => message.content).join('\n');

    expect(text).toContain('公共地点');
    expect(text).toContain('码头');
    expect(text).toContain('林小满');
    expect(text).toContain('不要写');
  });

  it('解析失败返回 E_MODEL_OUTPUT', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      retries: 0,
      fetchImpl: async () => completion('这不是 JSON'),
    });

    await expect(adapter.complete(planInput())).rejects.toMatchObject({
      code: 'E_MODEL_OUTPUT',
    });
  });

  it('超时返回 E_MODEL_TIMEOUT', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      timeoutMs: 10,
      retries: 0,
      fetchImpl: (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    });

    await expect(adapter.complete(planInput())).rejects.toMatchObject({
      code: 'E_MODEL_TIMEOUT',
    });
  });

  it('可配置重试：首次 500 后成功', async () => {
    let calls = 0;
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      retries: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ error: 'boom' }, 500);
        return completion('{"plan":[{"hour":6,"location":"码头","intent":"散步"}]}');
      },
    });

    const result = await adapter.complete(planInput());
    expect(result.plan[0].location).toBe('码头');
    expect(calls).toBe(2);
  });

  it('网络异常返回 E_INTERNAL', async () => {
    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      retries: 0,
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    await expect(adapter.complete(planInput())).rejects.toMatchObject({
      code: 'E_INTERNAL',
    });
  });

  it('日志中的 api_key 恒为脱敏值', async () => {
    const logs = [];
    const logger = createRedactedLogger({ info: (line) => logs.push(line) });
    expect(maskApiKey(API_KEY)).not.toContain('secret-value');

    const adapter = createModelAdapter({
      baseUrl: 'https://model.test/v1',
      apiKey: API_KEY,
      logger,
      fetchImpl: async () => completion('{"plan":[{"hour":7,"location":"店内","intent":"等客"}]}'),
    });
    await adapter.complete(planInput());

    const text = logs.join('\n');
    expect(text).not.toContain(API_KEY);
    expect(text).toContain('***');
    expect(text).toContain('"api_key"');
  });

  it('verifyApiKey 区分无效 Key 与额度不足', async () => {
    await expect(
      verifyApiKey({
        baseUrl: 'https://model.test/v1',
        apiKey: API_KEY,
        fetchImpl: async () => jsonResponse({}, 401),
      })
    ).rejects.toMatchObject({ code: 'E_KEY_INVALID' });

    await expect(
      verifyApiKey({
        baseUrl: 'https://model.test/v1',
        apiKey: API_KEY,
        fetchImpl: async () => jsonResponse({}, 402),
      })
    ).rejects.toMatchObject({ code: 'E_QUOTA_EXCEEDED' });
  });
});
