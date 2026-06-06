import { describe, expect, it } from 'vitest';

import { cn } from '../src/lib/cn.js';

describe('cn() shadcn-style class merger', () => {
  it('concatenates non-conflicting classes', () => {
    expect(cn('px-2', 'py-1', 'text-ink')).toBe('px-2 py-1 text-ink');
  });

  it('resolves Tailwind conflicts (last wins) via tailwind-merge', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles conditional classes via clsx', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });
});
