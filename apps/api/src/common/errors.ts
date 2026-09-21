/** 统一错误码与业务异常。客户端可依赖 code 做分支，不要解析 message。 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  TWO_FACTOR_INVALID: 'TWO_FACTOR_INVALID',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  FORBIDDEN: 'FORBIDDEN',
  SCOPE_MISSING: 'SCOPE_MISSING',
  API_KEY_INVALID: 'API_KEY_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  LICENSE_NOT_FOUND: 'LICENSE_NOT_FOUND',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
  LICENSE_REVOKED: 'LICENSE_REVOKED',
  LICENSE_SUSPENDED: 'LICENSE_SUSPENDED',
  LICENSE_BANNED: 'LICENSE_BANNED',
  LICENSE_NOT_STARTED: 'LICENSE_NOT_STARTED',
  USAGE_EXHAUSTED: 'USAGE_EXHAUSTED',
  DEVICE_LIMIT_REACHED: 'DEVICE_LIMIT_REACHED',
  DOMAIN_NOT_ALLOWED: 'DOMAIN_NOT_ALLOWED',
  DOMAIN_LIMIT_REACHED: 'DOMAIN_LIMIT_REACHED',
  DOMAIN_NOT_BOUND: 'DOMAIN_NOT_BOUND',
  DOMAIN_INVALID: 'DOMAIN_INVALID',
  DEVICE_BLACKLISTED: 'DEVICE_BLACKLISTED',
  DEVICE_NOT_BOUND: 'DEVICE_NOT_BOUND',
  DEVICE_APPROVAL_REQUIRED: 'DEVICE_APPROVAL_REQUIRED',
  OFFLINE_CODE_INVALID: 'OFFLINE_CODE_INVALID',
  OFFLINE_CODE_EXPIRED: 'OFFLINE_CODE_EXPIRED',
  TRIAL_ALREADY_USED: 'TRIAL_ALREADY_USED',
  REDEEM_CODE_INVALID: 'REDEEM_CODE_INVALID',
  REDEEM_CODE_USED: 'REDEEM_CODE_USED',
  REDEEM_CODE_EXPIRED: 'REDEEM_CODE_EXPIRED',
  COUPON_INVALID: 'COUPON_INVALID',
  CONFLICT: 'CONFLICT',
  ORDER_STATE_INVALID: 'ORDER_STATE_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  SETTINGS_INVALID: 'SETTINGS_INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** 业务异常：HttpException 的子类，携带稳定 code 与可选 details。 */
import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(message = '资源不存在', details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
  }
  static conflict(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
  static forbidden(message = '权限不足', details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.FORBIDDEN, message, HttpStatus.FORBIDDEN, details);
  }
  static unauthorized(code: ErrorCode = ErrorCodes.UNAUTHENTICATED, message = '请先登录') {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }
  static badRequest(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }
}