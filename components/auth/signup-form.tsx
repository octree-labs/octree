'use client';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';

interface SignUpFormProps extends React.ComponentPropsWithoutRef<'div'> {
  onboardingRedirect?: string;
  nextPath?: string | null;
}

export function SignUpForm({
  className,
  onboardingRedirect = '/onboarding',
  nextPath,
  ...props
}: SignUpFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      const signUpOptions: {
        emailRedirectTo?: string;
      } = {};

      if (nextPath) {
        signUpOptions.emailRedirectTo = `${window.location.origin}${nextPath}`;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: signUpOptions,
      });

      if (error) throw error;

      setSignupSuccess(true);
      // OAuth sign-ups never pass through this form; app/auth/oauth/route.ts
      // reports those server-side.
      track(AnalyticsEvents.SIGNUP_COMPLETED, { provider: 'email' });
      const conversionId = crypto.randomUUID();
      window.rdt?.('track', 'SignUp', { conversionId });
      fetch('/api/reddit-capi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'SignUp', conversionId, email }),
      }).catch(() => {});
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const loginHref = `/auth/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`;

  if (signupSuccess) {
    return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardContent className="flex flex-col items-center gap-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="size-6 text-primary" />
            </div>
            <div className="space-y-3">
              <h1 className="text-xl font-semibold text-neutral-900">Verify your email</h1>
              <p className="text-sm text-neutral-600">
                We sent a link to
                <span className="mt-1 block break-all font-medium text-neutral-900">{email}</span>
              </p>
              <p className="text-xs text-neutral-500">Not there? Check spam.</p>
            </div>
            <div className="flex flex-col items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setSignupSuccess(false);
                  setPassword('');
                  setRepeatPassword('');
                }}
                className="text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
              >
                Use a different email
              </button>
              <p className="text-neutral-600">
                Already confirmed?{' '}
                <Link href={loginHref} className="text-neutral-900 underline underline-offset-4">
                  Log in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repeat Password</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                variant="gradient"
                disabled={isLoading}
              >
                {isLoading ? 'Creating an account...' : 'Sign up'}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{' '}
              <Link href={loginHref} className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
