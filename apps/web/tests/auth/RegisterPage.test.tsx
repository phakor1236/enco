import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { apiClient } from '../../src/lib/apiClient.js';
import { RegisterPage } from '../../src/features/auth/RegisterPage.js';
import { useAuthStore } from '../../src/stores/authStore.js';

function renderRegister(): void {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildAxiosError(status: number, code: string): AxiosError {
  const response = {
    status,
    statusText: '',
    data: { error: { code, message: 'x' } },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() } as never,
  } as AxiosResponse;
  return new AxiosError('Request failed', String(status), undefined, null, response);
}

beforeEach(() => {
  useAuthStore.setState({ user: null, accessToken: null, initialized: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<RegisterPage />', () => {
  it('rejects passwords shorter than 8 chars before hitting the API', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(apiClient, 'post');
    renderRegister();

    await user.type(screen.getByLabelText(/電子信箱/), 'new@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'short');
    await user.click(screen.getByRole('button', { name: /建立帳號/ }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/密碼/)).toBeInvalid();
  });

  it('on success: sets session + navigates home', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        user: { id: 'u-new', email: 'fresh@vella.test', role: 'CUSTOMER' },
        accessToken: 'jwt-new',
      },
    } as AxiosResponse);
    renderRegister();

    await user.type(screen.getByLabelText(/電子信箱/), 'fresh@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'longenough123');
    await user.click(screen.getByRole('button', { name: /建立帳號/ }));

    await waitFor(() => {
      expect(screen.getByText('HOME')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().accessToken).toBe('jwt-new');
  });

  it('on 409 EMAIL_TAKEN: pins the error to the email field', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockRejectedValue(buildAxiosError(409, 'EMAIL_TAKEN'));
    renderRegister();

    await user.type(screen.getByLabelText(/電子信箱/), 'dup@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'longenough123');
    await user.click(screen.getByRole('button', { name: /建立帳號/ }));

    await waitFor(() => {
      expect(screen.getByText(/此信箱已被註冊/)).toBeInTheDocument();
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('on 429 RATE_LIMITED: shows daily-limit message', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockRejectedValue(buildAxiosError(429, 'RATE_LIMITED'));
    renderRegister();

    await user.type(screen.getByLabelText(/電子信箱/), 'rate@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'longenough123');
    await user.click(screen.getByRole('button', { name: /建立帳號/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/操作次數過多/);
    });
  });
});
