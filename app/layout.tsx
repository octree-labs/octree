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

const APP_URL = 'https://app.useoctree.com';
const DESCRIPTION =
  'Octree is an AI LaTeX editor. Write, edit, and compile LaTeX documents with AI assistance, generate documents from a prompt, and export to PDF.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'Octree – AI LaTeX Editor',
    template: '%s | Octree',
  },
  description: DESCRIPTION,
  applicationName: 'Octree',
  // The app is behind auth; only the auth routes opt back in to indexing.
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: 'Octree',
    title: 'Octree – AI LaTeX Editor',
    description: DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: 'summary',
    creator: '@useoctree',
    title: 'Octree – AI LaTeX Editor',
    description: DESCRIPTION,
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js?pixel_id=a2_eqcdwpyzgy6x",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init','a2_eqcdwpyzgy6x');rdt('track','PageVisit');`,
          }}
        />
      </head>
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
