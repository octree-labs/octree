import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign up',
  description:
    'Create a free Octree account and start writing LaTeX with AI. Generate documents from a prompt, compile to PDF, and edit with suggestions.',
  alternates: { canonical: '/auth/sign-up' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Sign up | Octree',
    description:
      'Create a free Octree account and start writing LaTeX with AI. Generate documents from a prompt, compile to PDF, and edit with suggestions.',
    url: '/auth/sign-up',
  },
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
