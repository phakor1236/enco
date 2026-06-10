import { AxiosError } from 'axios';

/** Extract a user-facing message from an API error response. */
export function extractApiError(err: unknown, fallback = '操作失敗'): string {
  return err instanceof AxiosError
    ? ((err.response?.data as { error?: { message?: string } })?.error?.message ?? fallback)
    : fallback;
}
