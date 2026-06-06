import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { Boot } from './components/Boot.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { useLogout } from './features/auth/useAuth.js';
import { useAuthStore } from './stores/authStore.js';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Boot>
        <Routes>
          <Route path="/" element={<HelloHome />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </Boot>
    </BrowserRouter>
  );
}

function HelloHome(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper text-ink">
      <div className="text-center flex flex-col items-center gap-4">
        <h1 className="text-4xl font-bold font-display">Hello, VELLA</h1>
        <p className="text-ink-soft">
          {user ? `Logged in as ${user.email} (${user.role})` : '尚未登入'}
        </p>
        {user ? (
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {logout.isPending ? '登出中…' : '登出'}
          </button>
        ) : (
          <div className="flex gap-3">
            <Link
              to="/login"
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary hover:bg-primary-press"
            >
              登入
            </Link>
            <Link
              to="/register"
              className="rounded-full border border-line bg-surface px-5 py-2 text-sm font-semibold text-ink hover:bg-paper-2"
            >
              註冊
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
