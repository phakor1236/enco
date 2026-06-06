import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Boot } from '../src/components/Boot.js';
import { useAuthStore } from '../src/stores/authStore.js';

beforeEach(() => {
  useAuthStore.setState({ user: null, accessToken: null, initialized: false });
});

describe('<Boot />', () => {
  it('renders a loading status while authStore.initialized is false', () => {
    render(
      <Boot>
        <div>app content</div>
      </Boot>,
    );
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
  });

  it('renders children once authStore.initialized flips to true', () => {
    useAuthStore.setState({ initialized: true });
    render(
      <Boot>
        <div>app content</div>
      </Boot>,
    );
    expect(screen.getByText('app content')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument();
  });
});
