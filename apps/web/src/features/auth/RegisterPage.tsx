import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RegisterBody } from '@app/shared';

import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';

import { authErrorCode, useRegister } from './useAuth.js';

interface FormErrors {
  email?: string;
  password?: string;
  form?: string;
}

export function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const register = useRegister();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErrors({});

    const parsed = RegisterBody.safeParse({ email, password });
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
      await register.mutateAsync(parsed.data);
      navigate('/');
    } catch (err) {
      const code = authErrorCode(err);
      if (code === 'EMAIL_TAKEN') {
        setErrors({ email: '此信箱已被註冊' });
      } else if (code === 'RATE_LIMITED') {
        setErrors({ form: '註冊嘗試次數過多，請改日再試' });
      } else if (code === 'VALIDATION_ERROR') {
        setErrors({ form: '輸入資料不符規範' });
      } else {
        setErrors({ form: '註冊失敗，請稍後再試' });
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
        <p className="text-ink-soft mb-8">建立新帳號</p>

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
            label="密碼（至少 8 字元）"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
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

          <Button type="submit" block disabled={register.isPending}>
            {register.isPending ? '建立中…' : '建立帳號'}
          </Button>

          <p className="mt-2 text-center text-sm text-ink-soft">
            已經有帳號？{' '}
            <Link to="/login" className="font-semibold text-primary hover:text-primary-press">
              立即登入
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
