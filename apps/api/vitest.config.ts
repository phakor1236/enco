import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/helpers/setup.ts'],
    // Suites mutate the shared test DB (cart.test flips SKU.stock,
    // products.test flips SKU.status). One worker process keeps them serial
    // so isolation can't depend on which row findFirst happens to pick.
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
