import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false, // Disable CSS processing for tests
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
  esbuild: {
    target: 'node14',
    // App components use Next's automatic JSX runtime (no React import), so
    // component tests need the same transform.
    jsx: 'automatic',
  },
});
