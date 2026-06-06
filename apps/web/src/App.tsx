import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Boot } from './components/Boot.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
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
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper text-ink">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-display">Hello, VELLA</h1>
        <p className="mt-2 text-ink-soft">
          {user ? `Logged in as ${user.email} (${user.role})` : '尚未登入'}
        </p>
      </div>
    </main>
  );
}
