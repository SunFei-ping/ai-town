/**
 * 告警帧构造，见 SPCD §7.5 / §7.6。
 * 告警只随流下发，不关闭流；任何告警都必须通过这里生成，保证结构一致。
 */
import { WARNING_CODES, WARNING_MESSAGES } from '../../shared/errors/codes.js';
import { encodeFrame } from './http.js';

export const WARNING_CATALOG = Object.freeze(
  Object.fromEntries(Object.values(WARNING_CODES).map((code) => [code, WARNING_MESSAGES[code]]))
);

export function createWarning(code, message) {
  if (!Object.hasOwn(WARNING_CODES, code)) {
    throw new Error(`未知告警码：${code}`);
  }
  return { code, message: message ?? WARNING_MESSAGES[code] };
}

export function warningFrame(id, code, message) {
  return encodeFrame(id, 'warning', createWarning(code, message));
}

/** 补算截断告警；M6-05 的补算流程会直接复用 */
export function backfillCappedWarning(id, { requested = 0, allowed = 0 } = {}) {
  return warningFrame(
    id,
    WARNING_CODES.W_BACKFILL_CAPPED,
    `本次最多补算 ${allowed} 天，剩余 ${Math.max(0, requested - allowed)} 天可稍后继续`
  );
}
