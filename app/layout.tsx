import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import { GoogleAnalytics } from '@next/third-parties/google';
import './globals.css';
import { ProjectProvider } from '@/app/context/project';
import { Toaster } from '@/components/ui/sonner';
import localFont from 'next/font/local';
import { PostHogProvider } from '@/components/providers/posthog';

const satoshi = localFont({
  src: [
    {
      path: './fonts/Satoshi-Variable.woff2',
      style: 'normal',
    },
    {
      path: './fonts/Satoshi-VariableItalic.woff2',
      style: 'italic',
    },
  ],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Octree',
  description: 'A latex editor that uses AI to help you write latex',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={satoshi.className}>
        <ProjectProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </ProjectProvider>
        <Toaster position="top-center" />
        <Analytics />
        <GoogleAnalytics gaId="G-2G3ZGGMJ2Y" />
      </body>
    </html>
  );
}
