import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { RequireAdmin } from '../../src/features/admin/RequireAdmin.js';
import { useAuthStore } from '../../src/stores/authStore.js';

function renderGuard(path = '/admin'): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={<RequireAdmin />}>
            <Route index element={<div>admin content</div>} />
          </Route>
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<RequireAdmin />', () => {
  it('renders null (nothing) when auth is not yet initialized', () => {
    useAuthStore.setState({ user: null, accessToken: null, initialized: false });
    const { container } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<RequireAdmin />}>
            <Route index element={<div>admin content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects CUSTOMER to home page', () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'c@test.com', role: 'CUSTOMER' },
      accessToken: 'tok',
      initialized: true,
    });
    renderGuard();
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated visitor to home page', () => {
    useAuthStore.setState({ user: null, accessToken: null, initialized: true });
    renderGuard();
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('renders Outlet for ADMIN', () => {
    useAuthStore.setState({
      user: { id: 'u2', email: 'a@test.com', role: 'ADMIN' },
      accessToken: 'tok',
      initialized: true,
    });
    renderGuard();
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('renders Outlet for SUPER_ADMIN', () => {
    useAuthStore.setState({
      user: { id: 'u3', email: 'sa@test.com', role: 'SUPER_ADMIN' },
      accessToken: 'tok',
      initialized: true,
    });
    renderGuard();
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });
});
