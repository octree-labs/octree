import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // createProjectFromLatex carries a whole main.tex (up to 1 MB on the
      // client, plus JSON escaping of every backslash and newline). The
      // default 1 MB limit fails such calls with an opaque error.
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
