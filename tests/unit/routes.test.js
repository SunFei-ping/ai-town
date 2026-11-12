import { describe, it, expect } from 'vitest';
import {
  ROUTES,
  DEFAULT_ROUTE,
  parseHash,
  resolveRoute,
  toHash,
} from '../../web/app/routes.js';

describe('路由纯逻辑', () => {
  it('包含四个屏幕', () => {
    expect(ROUTES).toEqual(['home', 'create', 'town', 'year']);
  });

  it('解析普通 hash', () => {
    expect(parseHash('#/create')).toBe('create');
    expect(parseHash('#/town')).toBe('town');
  });

  it('空 hash 回落到默认路由', () => {
    expect(resolveRoute(parseHash(''))).toBe(DEFAULT_ROUTE);
    expect(resolveRoute(parseHash(undefined))).toBe(DEFAULT_ROUTE);
  });

  it('忽略查询串', () => {
    expect(parseHash('#/town?day=2')).toBe('town');
  });

  it('非法路由回落到首页', () => {
    expect(resolveRoute('nope')).toBe('home');
    expect(resolveRoute('')).toBe('home');
  });

  it('toHash 生成合法地址', () => {
    expect(toHash('year')).toBe('#/year');
    expect(toHash('nope')).toBe('#/home');
  });
});
