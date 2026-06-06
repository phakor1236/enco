import type { ReactNode } from 'react';

import { useAuthStore } from '../stores/authStore.js';

/**
 * Splash guard. Holds the UI on a loading state until the boot-time
 * silent refresh probe resolves (success or failure). Without this, any
 * component reading useAuthStore.user during the first ~150ms would see
 * `null` even if the user has a valid HttpOnly refresh cookie — flashing
 * "logged out" then "logged in" looks broken on F5.
 */
export function Boot({ children }: { children: ReactNode }): JSX.Element {
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) {
    return (
      <div
        role="status"
        aria-label="Loading"
        className="min-h-screen flex items-center justify-center bg-paper"
      >
        <div
          className="size-10 rounded-full border-4 border-primary-tint-2 border-t-primary animate-spin"
          aria-hidden
        />
      </div>
    );
  }
  return <>{children}</>;
}
