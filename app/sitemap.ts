import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://www.useoctree.com'

  const staticPages = [
    '',
    '/contact',
    '/buy',
    '/refund-policy',
    '/privacy',
    '/terms',
    '/about',
    '/auth/login',
    '/auth/sign-up',
  ]

  const learnPages = [
    '/learn',
    '/learn/latex',
    '/learn/tikz',
    '/learn/pgfplots',
    '/learn/bold-italics-underline',
    '/learn/page-size-margins',
    '/learn/subscripts-superscripts',
    '/learn/lists',
    '/learn/greek-letters-math-symbols',
    '/learn/colors',
    '/learn/mathematical-expressions',
    '/learn/integrals-sums-limits',
    '/learn/matrices',
    '/learn/tables',
  ]

  const blogPages = [
    '/blog',
    '/blog/complement-of-an-angle-definition-formula-examples',
    '/blog/delta-math-understanding-change-difference',
    '/blog/omega-symbol-meaning-uses-math-science',
    '/blog/subscript-superscript-complete-guide',
    '/blog/alpha-symbol-uses-meaning-complete-guide',
    '/blog/sigma-symbol-meaning-uses-how-to-type',
    '/blog/canva-resume-templates-job-search-guide',
    '/blog/delta-symbols-math-science-complete-guide',
    '/blog/best-latex-editors-mac-comparison',
    '/blog/crixet-to-prism',
  ]

  const allPages = [...staticPages, ...learnPages, ...blogPages]

  return allPages.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: path.startsWith('/learn') || path.startsWith('/blog')
      ? 'weekly' as const
      : 'monthly' as const,
    priority: path === '' ? 1 : path.startsWith('/learn') ? 0.8 : 0.6,
  }))
}
