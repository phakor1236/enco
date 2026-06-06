/**
 * Map API ErrorResponse codes to user-facing Chinese copy. Centralized so
 * Login, Register, and any future auth-touching screen show the same wording
 * for the same code.
 */
export function localizeAuthError(code: string | null, fallback: string): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return '帳號或密碼錯誤';
    case 'EMAIL_TAKEN':
      return '此信箱已被註冊';
    case 'RATE_LIMITED':
      return '操作次數過多，請稍後再試';
    case 'VALIDATION_ERROR':
      return '輸入資料不符規範';
    case 'TOKEN_EXPIRED':
    case 'INVALID_TOKEN':
    case 'TOKEN_REUSED':
      return '登入狀態已失效，請重新登入';
    default:
      return fallback;
  }
}
