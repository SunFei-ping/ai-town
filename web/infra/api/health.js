/**
 * 连通性与版本检查客户端，见 SPCD §7.2 端点 7 与 §13.4。
 */
export async function fetchHealth({ fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl('/v1/health', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`health 返回 ${res.status}`);
  return res.json();
}
