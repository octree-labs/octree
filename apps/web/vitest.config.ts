import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./@__tests__/setup.ts'],
    css: false, // Disable CSS processing for tests
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
  esbuild: {
    target: 'node14',
  },
});
