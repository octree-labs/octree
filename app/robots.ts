import type { MetadataRoute } from 'next';

// app.useoctree.com is the authenticated product. Everything except the
// public auth entry points redirects to /auth/login, so only those are
// worth crawling. The marketing site (www.useoctree.com) owns the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/auth/login', '/auth/sign-up'],
        disallow: '/',
      },
    ],
  };
}
