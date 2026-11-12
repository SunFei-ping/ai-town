import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  ERROR_MESSAGES,
  WARNING_CODES,
  WARNING_MESSAGES,
  toErrorBody,
} from '../../shared/errors/codes.js';

describe('错误码与告警码', () => {
  it('恰好 12 个错误码，与 SPCD §7.5 一致', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(12);
  });

  it('恰好 5 个告警码，与 SPCD §7.5 一致', () => {
    expect(Object.keys(WARNING_CODES)).toHaveLength(5);
  });

  it('每个错误码都有状态码、可重试标记与中文提示', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_HTTP_STATUS[code], code).toBeTypeOf('number');
      expect(ERROR_RETRYABLE[code], code).toBeTypeOf('boolean');
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  it('每个告警码都有中文提示', () => {
    for (const code of Object.values(WARNING_CODES)) {
      expect(WARNING_MESSAGES[code], code).toBeTruthy();
    }
  });

  it('toErrorBody 产出 SPCD §7.1 规定的结构', () => {
    const body = toErrorBody(ERROR_CODES.E_KEY_INVALID, undefined, 'trace-1');
    expect(body).toEqual({
      error: {
        code: 'E_KEY_INVALID',
        message: ERROR_MESSAGES.E_KEY_INVALID,
        retryable: false,
        trace_id: 'trace-1',
      },
    });
  });
});
