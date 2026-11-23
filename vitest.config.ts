import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'reports/coverage',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      all: true,
      include: [
        'apps/server/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
        'packages/contracts/src/**/*.ts',
      ],
      exclude: ['**/*.test.*', '**/*.integration.test.*', 'apps/server/src/generated/**'],
    },
  },
});
