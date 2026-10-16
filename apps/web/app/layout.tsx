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
