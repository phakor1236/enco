import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LoginBody } from '@app/shared';

import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';

import { authErrorCode, useLogin } from './useAuth.js';

interface FormErrors {
  email?: string;
  password?: string;
  form?: string;
}

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErrors({});

    const parsed = LoginBody.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' && !fieldErrors.email) fieldErrors.email = issue.message;
        if (field === 'password' && !fieldErrors.password) fieldErrors.password = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      await login.mutateAsync(parsed.data);
      navigate('/');
    } catch (err) {
      const code = authErrorCode(err);
      if (code === 'INVALID_CREDENTIALS') {
        setErrors({ form: '帳號或密碼錯誤' });
      } else if (code === 'RATE_LIMITED') {
        setErrors({ form: '登入嘗試次數過多，請稍後再試' });
      } else {
        setErrors({ form: '登入失敗，請稍後再試' });
      }
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md">
        <h1
          className="text-3xl font-bold mb-2 text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          VELLA
        </h1>
        <p className="text-ink-soft mb-8">會員登入</p>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field
            label="電子信箱"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Field
            label="密碼"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />

          {errors.form && (
            <div
              role="alert"
              className="rounded-md bg-danger-tint px-3 py-2 text-sm font-semibold text-danger"
            >
              {errors.form}
            </div>
          )}

          <Button type="submit" block disabled={login.isPending}>
            {login.isPending ? '登入中…' : '登入'}
          </Button>

          <p className="mt-2 text-center text-sm text-ink-soft">
            還沒有帳號？{' '}
            <Link to="/register" className="font-semibold text-primary hover:text-primary-press">
              立即註冊
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
