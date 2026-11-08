/**
 * First-party relay for PostHog.
 *
 * posthog-js used to post straight to us.i.posthog.com, a host every common
 * ad/tracking blocklist (uBlock Origin, Brave Shields, AdGuard, EasyPrivacy)
 * blocks. A blocked browser sent nothing at all: no $pageview, no $identify,
 * so the sign-up, import and checkout events captured on the server for that
 * user sat on a person with no browser activity (23% of sign-ups,
 * 2026-10-18 → 11-08). Sending through a path on app.useoctree.com keeps the
 * requests first-party; next.config.ts rewrites them to PostHog.
 *
 * Shared by next.config.ts (rewrites), middleware.ts (matcher exclusion) and
 * components/providers/posthog.tsx (api_host), so it must stay free of
 * server-only and client-only imports.
 */

/** Path prefix on the app's own origin that forwards to PostHog. */
export const POSTHOG_RELAY_PATH = '/relay-o7';

const DEFAULT_INGEST_HOST = 'https://us.i.posthog.com';

/**
 * The PostHog ingestion host the relay forwards to. A NEXT_PUBLIC_POSTHOG_HOST
 * that already points at the relay (or any relative path) falls back to the
 * default so the rewrite can never point at itself.
 */
export function resolveIngestHost(configured?: string | null): string {
  const value = configured?.trim().replace(/\/+$/, '');
  if (!value || !/^https?:\/\//.test(value)) return DEFAULT_INGEST_HOST;
  return value;
}

/** us.i.posthog.com -> us-assets.i.posthog.com (static bundles, remote config). */
export function assetsHostFor(ingestHost: string): string {
  return ingestHost.replace(/^(https?:\/\/)(us|eu)\.i\.posthog\.com$/, '$1$2-assets.i.posthog.com');
}

/** The PostHog web app (links in the toolbar), for `ui_host`. */
export function uiHostFor(ingestHost: string): string {
  const match = ingestHost.match(/^https?:\/\/(us|eu)\.i\.posthog\.com$/);
  return match ? `https://${match[1]}.posthog.com` : ingestHost;
}

export interface Rewrite {
  source: string;
  destination: string;
}

/**
 * Order matters: the asset paths must come before the catch-all so the
 * recorder/surveys bundles and remote config are fetched from the assets host.
 */
export function posthogRelayRewrites(configuredHost?: string | null): Rewrite[] {
  const ingest = resolveIngestHost(configuredHost);
  const assets = assetsHostFor(ingest);
  return [
    { source: `${POSTHOG_RELAY_PATH}/static/:path*`, destination: `${assets}/static/:path*` },
    { source: `${POSTHOG_RELAY_PATH}/array/:path*`, destination: `${assets}/array/:path*` },
    { source: `${POSTHOG_RELAY_PATH}/:path*`, destination: `${ingest}/:path*` },
  ];
}
