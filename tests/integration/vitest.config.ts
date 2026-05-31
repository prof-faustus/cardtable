import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    // Live network tests can take a moment over slow CI runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
