import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Log in',
  description:
    'Log in to Octree, the AI LaTeX editor. Pick up your projects, compile to PDF, and write with AI assistance.',
  alternates: { canonical: '/auth/login' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Log in | Octree',
    description:
      'Log in to Octree, the AI LaTeX editor. Pick up your projects, compile to PDF, and write with AI assistance.',
    url: '/auth/login',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
