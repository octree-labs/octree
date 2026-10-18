'use client';

import { useEffect, useRef } from 'react';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import type { User } from '@supabase/supabase-js';

import { identifyUser, resetAnalytics } from '@/lib/analytics/track';
import { getUserIdentityTraits } from '@/lib/requests/user';
import { createClient } from '@/lib/supabase/client';

/**
 * One PostHog project is shared by app., www. and tools.useoctree.com, so the
 * cookie lives on `.useoctree.com` (`cross_subdomain_cookie`, the default) and
 * persistence is `localStorage+cookie`: the distinct id crosses subdomains via
 * the cookie while the bulk of the state stays in localStorage.
 *
 * Without NEXT_PUBLIC_POSTHOG_KEY (local dev, tests) nothing is initialised and
 * every wrapper in lib/analytics/track.ts stays a no-op.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      defaults: '2025-05-24',
      person_profiles: 'identified_only',
      cross_subdomain_cookie: true,
      persistence: 'localStorage+cookie',
      // The App Router navigates without full loads; `history_change` is a
      // pageview on the initial load and on every client-side route change.
      capture_pageview: 'history_change',
      capture_pageleave: true,
      capture_exceptions: true,
      // Session replay is switched on in the PostHog project. LaTeX source
      // (Monaco), the PDF preview and every input are masked so document
      // content never leaves the browser, and the PDF viewer is blocked
      // outright. Canvas capture (pdf.js pages) is a project-level setting
      // in PostHog and stays off; posthog-js does not expose it client-side.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '.monaco-editor, [data-ph-mask], .pdf-preview',
        blockSelector: '.pdf-preview',
      },
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}

/**
 * Identifies the Supabase user once per browser session and resets PostHog
 * on sign-out. Listens to the auth state so it works for every entry point
 * (password login, OAuth redirect, magic link) without each page opting in.
 */
function PostHogIdentify() {
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

    const supabase = createClient();
    let cancelled = false;

    const identify = async (user: User) => {
      if (identifiedUserId.current === user.id) return;
      identifiedUserId.current = user.id;

      const traits = await getUserIdentityTraits(user.id).catch(() => null);
      if (cancelled) return;

      identifyUser(user.id, {
        email: user.email,
        provider: user.app_metadata?.provider ?? null,
        created_at: user.created_at,
        is_pro: traits?.is_pro,
        subscription_status: traits?.subscription_status,
        role: traits?.role,
        referral_source: traits?.referral_source,
      });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void identify(data.session.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        identifiedUserId.current = null;
        resetAnalytics();
        return;
      }
      if (session?.user) void identify(session.user);
    });

    return () => {
      cancelled = true;
      identifiedUserId.current = null;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
