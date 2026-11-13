/**
 * Pages Functions 同源反向代理：/v1/* → API Worker。
 *
 * 背景：静态站部署在 Pages，函数部署在 Workers；浏览器只访问 Pages 域名，
 * 避免 workers.dev 在部分网络被污染。Worker 地址随 preview 环境固定。
 */
const API_ORIGIN = 'https://ai-town-api-preview.ai-town-7e28.workers.dev';

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, API_ORIGIN);

  const init = {
    method: context.request.method,
    headers: context.request.headers,
    redirect: 'manual',
  };
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body;
  }

  return fetch(new Request(target.toString(), init));
}
