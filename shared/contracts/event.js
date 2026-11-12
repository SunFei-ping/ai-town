/**
 * 用户事件契约，见 SPCD §7.7。
 * 前后端共用同一套校验：前端提交前先过一遍，服务端端点再校验一次。
 */
import { fail } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/codes.js';
import { EVENT_TYPES, FIELD_LIMITS } from './index.js';

/** 对居民的直接指令一律拒绝（E_VALIDATION） */
const DIRECTIVE_PATTERNS = [
  /让[^，。！？\n]{0,10}(去|来|说|做|表白|离开|答应)/u,
  /叫[^，。！？\n]{0,10}(去|来|说|做|表白|离开|答应)/u,
  /(命令|要求)[^，。！？\n]{0,10}(必须|一定|立刻|马上)/u,
];

/** 命中安全规则的内容（E_CONTENT_BLOCKED） */
const BLOCKED_PATTERNS = [
  /自杀|杀人|炸弹|毒品|枪支/u,
  /身份证|银行卡|手机号/u,
  /\d{11,}/u,
  /[\w.+-]+@[\w-]+\.[\w.]+/u,
];

/**
 * 校验事件入参并返回收敛后的 { type, payload }。
 * 未知 type 一律拒绝，不做静默兼容。
 */
export function validateEventInput(event) {
  if (!event || typeof event !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, '事件必须是对象');
  }
  if (!EVENT_TYPES.includes(event.type)) {
    fail(ERROR_CODES.E_VALIDATION, `未知的事件类型：${event.type}`);
  }
  if (typeof event.payload !== 'string' || event.payload.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, '事件内容不能为空');
  }
  const payload = event.payload.trim();
  if (payload.length > FIELD_LIMITS.EVENT_PAYLOAD_MAX) {
    fail(
      ERROR_CODES.E_VALIDATION,
      `事件内容不能超过 ${FIELD_LIMITS.EVENT_PAYLOAD_MAX} 个字符`
    );
  }
  if (DIRECTIVE_PATTERNS.some((pattern) => pattern.test(payload))) {
    fail(ERROR_CODES.E_VALIDATION, '事件只能描述外部发生的事，不能直接指挥居民');
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(payload))) {
    fail(ERROR_CODES.E_CONTENT_BLOCKED, '事件内容未通过安全校验');
  }
  return { type: event.type, payload };
}
