/**
 * 领域层统一抛出的错误类型。
 * 携带 SPCD §7.5 的错误码，便于上层直接映射为响应体或提示。
 */
export class AppError extends Error {
  constructor(code, message, details) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new AppError(code, message, details);
}
