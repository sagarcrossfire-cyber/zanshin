import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      exclude: ['src/main.tsx', 'src/app/**', '**/*.spec.*', 'tests/**'],
      include: ['src/domain/**', 'src/data/import/**'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.tsx', 'tests/integration/**/*.spec.ts', 'tests/integration/**/*.spec.tsx'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 10000,
  },
});
