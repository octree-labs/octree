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
      // Next.js resolves `server-only` itself at build time (to this same
      // shim on the server). Vitest has no such rule, so server modules that
      // import it (lib/stripe.ts, lib/supabase/admin.ts) need the alias to load.
      'server-only': resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  esbuild: {
    target: 'node14',
    // App components use Next's automatic JSX runtime (no React import), so
    // component tests need the same transform.
    jsx: 'automatic',
  },
});
