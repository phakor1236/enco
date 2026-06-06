import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { apiClient } from '../src/lib/apiClient.js';
import { useAuthStore } from '../src/stores/authStore.js';

beforeEach(() => {
  // Skip the Boot splash so the routed content actually renders.
  useAuthStore.setState({ user: null, accessToken: null, initialized: true });
  // Home page fires /categories and /products on mount. Stub to a no-op so
  // the tests don't depend on a real network and don't pollute the cache.
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { items: [] } } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderApp(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe('<App />', () => {
  it('renders the storefront hero on the root route', () => {
    renderApp();
    expect(
      screen.getByRole('heading', { name: /Made for the long way home/i }),
    ).toBeInTheDocument();
  });

  it('renders inside a <main> landmark', () => {
    renderApp();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
