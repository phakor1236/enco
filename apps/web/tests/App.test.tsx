import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { useAuthStore } from '../src/stores/authStore.js';

beforeEach(() => {
  // Skip the Boot splash so the routed content actually renders.
  useAuthStore.setState({ user: null, accessToken: null, initialized: true });
});

function renderApp(): void {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe('<App />', () => {
  it('renders the VELLA hello heading on the root route', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: /Hello, VELLA/i })).toBeInTheDocument();
  });

  it('renders inside a <main> landmark', () => {
    renderApp();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
