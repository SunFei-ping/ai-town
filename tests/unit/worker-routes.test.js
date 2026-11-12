import { describe, it, expect } from 'vitest';
import worker from '../../functions/worker.js';

function call(pathname, init) {
  return worker.fetch(new Request(`https://example.test${pathname}`, init), {});
}

describe('worker 入口路由（worker-routes）', () => {
  it('GET /v1/health 路由到 health 处理器', async () => {
    const res = await call('/v1/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /v1/templates 路由到模板列表', async () => {
    const res = await call('/v1/templates');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const data = await res.json();
    expect(data.templates).toHaveLength(3);
  });

  it('GET /v1/templates/{id} 路由到模板详情，兼容结尾斜杠', async () => {
    for (const path of ['/v1/templates/seaside', '/v1/templates/seaside/']) {
      const res = await call(path);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.template.id).toBe('seaside');
      expect(data.template.agents).toHaveLength(5);
    }
  });

  it('未知模板 id 返回 400 E_VALIDATION', async () => {
    const res = await call('/v1/templates/not-exist');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('E_VALIDATION');
  });

  it('未注册路径返回 404', async () => {
    const res = await call('/v1/not-a-route');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('E_INTERNAL');
  });
});
