import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './backend',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'backend/src'),
      '@clients': resolve(__dirname, 'backend/src/clients'),
      '@services': resolve(__dirname, 'backend/src/services'),
      '@types': resolve(__dirname, 'backend/src/types'),
      '@config': resolve(__dirname, 'backend/src/config'),
      '@engine': resolve(__dirname, 'backend/src/engine'),
    },
  },
});
