import type { NextConfig } from 'next';

import { posthogRelayRewrites } from './lib/analytics/posthog-proxy';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // createProjectFromLatex carries a whole main.tex (up to 1 MB on the
      // client, plus JSON escaping of every backslash and newline). The
      // default 1 MB limit fails such calls with an opaque error.
      bodySizeLimit: '2mb',
    },
  },
  // posthog-js posts to paths with trailing slashes (/e/, /flags/); a 308 to
  // the slash-less path would drop the request body. See lib/analytics/posthog-proxy.ts.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogRelayRewrites(process.env.NEXT_PUBLIC_POSTHOG_HOST);
  },
};

export default nextConfig;
