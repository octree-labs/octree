import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  POSTHOG_RELAY_PATH,
  assetsHostFor,
  posthogRelayRewrites,
  resolveIngestHost,
  uiHostFor,
} from '@/lib/analytics/posthog-proxy';

describe('posthog relay', () => {
  it('defaults to the US ingestion host', () => {
    expect(resolveIngestHost(undefined)).toBe('https://us.i.posthog.com');
    expect(resolveIngestHost('')).toBe('https://us.i.posthog.com');
  });

  it('never forwards to a relative host (no self-referencing rewrite)', () => {
    expect(resolveIngestHost(POSTHOG_RELAY_PATH)).toBe('https://us.i.posthog.com');
  });

  it('keeps a configured absolute host, without trailing slashes', () => {
    expect(resolveIngestHost('https://eu.i.posthog.com/')).toBe('https://eu.i.posthog.com');
  });

  it('derives the assets and UI hosts', () => {
    expect(assetsHostFor('https://us.i.posthog.com')).toBe('https://us-assets.i.posthog.com');
    expect(assetsHostFor('https://eu.i.posthog.com')).toBe('https://eu-assets.i.posthog.com');
    expect(uiHostFor('https://us.i.posthog.com')).toBe('https://us.posthog.com');
    expect(uiHostFor('https://ph.example.com')).toBe('https://ph.example.com');
  });

  it('routes static bundles and remote config to the assets host before the catch-all', () => {
    expect(posthogRelayRewrites(undefined)).toEqual([
      {
        source: `${POSTHOG_RELAY_PATH}/static/:path*`,
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: `${POSTHOG_RELAY_PATH}/array/:path*`,
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: `${POSTHOG_RELAY_PATH}/:path*`,
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]);
  });

  it('is excluded from the auth middleware matcher', () => {
    const middleware = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(middleware).toContain(`(?!_next/static|${POSTHOG_RELAY_PATH.slice(1)}|`);
  });
});
