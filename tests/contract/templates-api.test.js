import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import handler from '../../functions/templates/index.js';
import { validateTemplate, validateTemplateMeta } from '../../shared/contracts/template.js';

const TEMPLATE_DIR = new URL('../../data/templates/', import.meta.url);

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, TEMPLATE_DIR), 'utf8'));
}

async function request(path, method = 'GET') {
  return handler({ method, path });
}

describe('模板端点契约（templates-api）', () => {
  it('GET /v1/templates 返回三套模板元信息，且与 index.json 一致', async () => {
    const result = await request('/v1/templates');
    expect(result.status).toBe(200);
    expect(result.body.templates).toHaveLength(3);

    const index = readJson('index.json');
    for (const [i, meta] of result.body.templates.entries()) {
      expect(validateTemplateMeta(meta)).toEqual(meta);
      expect(meta).toEqual(index.templates[i]);
    }
    expect(result.body.templates.map((meta) => meta.id)).toEqual([
      'seaside',
      'campus',
      'demolition',
    ]);
  });

  it('列表端点兼容结尾斜杠', async () => {
    const result = await request('/v1/templates/');
    expect(result.status).toBe(200);
    expect(result.body.templates).toHaveLength(3);
  });

  it('GET /v1/templates/{id} 返回含 5 个居民的完整模板', async () => {
    for (const id of ['seaside', 'campus', 'demolition']) {
      const result = await request(`/v1/templates/${id}`);
      expect(result.status).toBe(200);
      const template = result.body.template;
      expect(validateTemplate(template)).toEqual(template);
      expect(template.id).toBe(id);
      expect(template.agents).toHaveLength(5);
      expect(template).toEqual(readJson(`${id}.json`));
    }
  });

  it('未知模板 id 返回 E_VALIDATION', async () => {
    const result = await request('/v1/templates/not-exist');
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('E_VALIDATION');
    expect(result.body.error.retryable).toBe(false);
  });

  it('非 GET 方法返回 E_VALIDATION', async () => {
    const result = await request('/v1/templates', 'POST');
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('E_VALIDATION');
  });
});
