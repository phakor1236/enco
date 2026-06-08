import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { apiClient } from '../../src/lib/apiClient.js';
import { LoginPage } from '../../src/features/auth/LoginPage.js';
import { useAuthStore } from '../../src/stores/authStore.js';

function renderLogin(): void {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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

describe('<LoginPage />', () => {
  it('renders the form and the register link', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /VELLA/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/電子信箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密碼/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登入/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /立即註冊/ })).toBeInTheDocument();
  });

  it('blocks submit and shows inline error when email is invalid', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(apiClient, 'post');
    renderLogin();

    await user.type(screen.getByLabelText(/電子信箱/), 'not-an-email');
    await user.type(screen.getByLabelText(/密碼/), 'password123');
    await user.click(screen.getByRole('button', { name: /登入/ }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/電子信箱/)).toBeInvalid();
  });

  it('on success: sets authStore session + navigates to /', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        user: { id: 'u-1', email: 'happy@vella.test', role: 'CUSTOMER' },
        accessToken: 'jwt-happy',
        cartMergeResult: { truncatedItems: [], droppedItems: [] },
      },
    } as AxiosResponse);
    renderLogin();

    await user.type(screen.getByLabelText(/電子信箱/), 'happy@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'password123');
    await user.click(screen.getByRole('button', { name: /登入/ }));

    await waitFor(() => {
      expect(screen.getByText('HOME')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().accessToken).toBe('jwt-happy');
    expect(useAuthStore.getState().user?.email).toBe('happy@vella.test');
  });

  it('on 401 INVALID_CREDENTIALS: shows form error, leaves session empty', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockRejectedValue(buildAxiosError(401, 'INVALID_CREDENTIALS'));
    renderLogin();

    await user.type(screen.getByLabelText(/電子信箱/), 'wrong@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'badpassword');
    await user.click(screen.getByRole('button', { name: /登入/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/帳號或密碼錯誤/);
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('on 429 RATE_LIMITED: shows specific message', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'post').mockRejectedValue(buildAxiosError(429, 'RATE_LIMITED'));
    renderLogin();

    await user.type(screen.getByLabelText(/電子信箱/), 'rate@vella.test');
    await user.type(screen.getByLabelText(/密碼/), 'whatever1');
    await user.click(screen.getByRole('button', { name: /登入/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/操作次數過多/);
    });
  });
});
