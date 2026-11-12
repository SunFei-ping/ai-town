/**
 * 路由的纯逻辑部分：不触碰 DOM，可直接被单元测试覆盖。
 * 路由采用 hash，保证在任意静态托管上刷新都不 404。
 */

export const ROUTES = Object.freeze(['home', 'create', 'town', 'year']);

export const DEFAULT_ROUTE = 'home';

export const ROUTE_LABELS = Object.freeze({
  home: 'AI小镇',
  create: '建镇',
  town: '小镇',
  year: '年报',
});

/**
 * 从 location.hash 解析出路由名。
 * '#/create' -> 'create'；'' -> 'home'；'#/town?x=1' -> 'town'
 */
export function parseHash(hash) {
  const raw = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('?')[0]
    .trim();
  return raw;
}

/**
 * 把任意输入收敛为合法路由，非法一律回落到默认路由。
 */
export function resolveRoute(name) {
  return ROUTES.includes(name) ? name : DEFAULT_ROUTE;
}

/**
 * 生成某个路由的 hash。
 */
export function toHash(route) {
  return `#/${resolveRoute(route)}`;
}
