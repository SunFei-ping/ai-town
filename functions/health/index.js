import { SCHEMA_VERSION } from '../../shared/contracts/index.js';
import { toErrorBody, ERROR_CODES } from '../../shared/errors/codes.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * GET /v1/health
 * 返回 { ok, model_reachable, latency_ms, version }
 * 不带小镇 id，见 SPCD §7.2 端点 7。
 */
export default async function handler({ method }) {
  if (method !== 'GET') {
    return {
      status: 405,
      headers: JSON_HEADERS,
      body: toErrorBody(ERROR_CODES.E_VALIDATION, 'health 只支持 GET'),
    };
  }

  const base = globalThis.process?.env?.MODEL_BASE_URL ?? '';
  let modelReachable = false;
  let latencyMs = 0;

  if (base) {
    const started = Date.now();
    try {
      const res = await fetch(base, { method: 'HEAD' });
      modelReachable = res.status < 500;
    } catch {
      modelReachable = false;
    }
    latencyMs = Date.now() - started;
  }

  return {
    status: 200,
    headers: JSON_HEADERS,
    body: {
      ok: true,
      model_reachable: modelReachable,
      latency_ms: latencyMs,
      version: SCHEMA_VERSION,
    },
  };
}
