import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { useAuthStore } from '../src/stores/authStore.js';

beforeEach(() => {
  // Skip the Boot splash so the routed content actually renders.
  useAuthStore.setState({ user: null, accessToken: null, initialized: true });
});

describe('<App />', () => {
  it('renders the VELLA hello heading on the root route', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Hello, VELLA/i })).toBeInTheDocument();
  });

  it('renders inside a <main> landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
