import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
