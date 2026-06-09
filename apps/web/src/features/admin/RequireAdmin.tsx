import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from '../../stores/authStore.js';

/** Redirects non-admin visitors to the home page. */
export function RequireAdmin(): JSX.Element | null {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);

  if (!initialized) return null;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
