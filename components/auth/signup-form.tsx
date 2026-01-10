'use client';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
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
import { CheckCircle2 } from 'lucide-react';

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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      {signupSuccess && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-green-900">
              Account created successfully!
            </p>
            <p className="text-sm text-green-700">
              Please check your email ({email}) to verify your account before
              signing in.
            </p>
          </div>
        </div>
      )}
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
                  disabled={signupSuccess}
                />
              </div>
              {!signupSuccess && (
                <>
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
                </>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              {!signupSuccess && (
                <Button
                  type="submit"
                  className="w-full"
                  variant="gradient"
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating an account...' : 'Sign up'}
                </Button>
              )}
            </div>
            <div className="pt-1 text-center text-sm">
              Already have an account?{' '}
              <Link
                href={`/auth/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`}
                className="underline underline-offset-4"
              >
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
