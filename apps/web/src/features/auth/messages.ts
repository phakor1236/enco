import { ErrorCodes } from '@app/shared';

/**
 * Map API ErrorResponse codes to user-facing Chinese copy. Centralized so
 * Login, Register, and any future auth-touching screen show the same wording
 * for the same code. Codes come from @app/shared so a BE rename here breaks
 * the build instead of silently falling back.
 */
export function localizeAuthError(code: string | null, fallback: string): string {
  switch (code) {
    case ErrorCodes.INVALID_CREDENTIALS:
      return '帳號或密碼錯誤';
    case ErrorCodes.EMAIL_TAKEN:
      return '此信箱已被註冊';
    case ErrorCodes.RATE_LIMITED:
      return '操作次數過多，請稍後再試';
    case ErrorCodes.VALIDATION_ERROR:
      return '輸入資料不符規範';
    case ErrorCodes.TOKEN_EXPIRED:
    case ErrorCodes.INVALID_TOKEN:
    case ErrorCodes.TOKEN_REUSED:
      return '登入狀態已失效，請重新登入';
    default:
      return fallback;
  }
}
