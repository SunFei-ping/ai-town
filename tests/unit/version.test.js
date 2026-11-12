import { describe, it, expect } from 'vitest';
import { isSchemaCompatible, parseSchemaVersion } from '../../shared/contracts/index.js';

describe('版本兼容（version）', () => {
  it('解析主.次.补丁', () => {
    expect(parseSchemaVersion('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseSchemaVersion('v1.0.0')).toBeNull();
    expect(parseSchemaVersion('')).toBeNull();
  });

  it('主版本与次版本一致才兼容，补丁号可不同', () => {
    expect(isSchemaCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isSchemaCompatible('1.0.0', '1.0.7')).toBe(true);
    expect(isSchemaCompatible('1.0.0', '1.1.0')).toBe(false);
    expect(isSchemaCompatible('1.0.0', '2.0.0')).toBe(false);
  });

  it('版本缺失或格式不合法时不兼容', () => {
    expect(isSchemaCompatible('1.0.0', undefined)).toBe(false);
    expect(isSchemaCompatible('1.0.0', 'latest')).toBe(false);
  });
});
