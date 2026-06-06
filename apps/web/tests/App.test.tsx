import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';

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
