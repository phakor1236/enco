import { test as base } from '@playwright/test';

import { resetAndSeed } from './db.js';

export { expect } from '@playwright/test';

type E2EFixtures = {
  /** Opt-in fixture: reseeds demo accounts + catalog before the test. */
  resetAndSeed: void;
};

export const test = base.extend<E2EFixtures>({
  resetAndSeed: [
    async (_fixtures, use) => {
      await resetAndSeed();
      await use();
    },
    { auto: false },
  ],
});
