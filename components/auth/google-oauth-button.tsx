'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import GoogleLogo from '@/components/icons/google-logo';

interface GoogleOAuthButtonProps {
  /** Path to land on after `/auth/oauth` exchanges the code. */
  nextPath: string;
  label?: string;
  className?: string;
  variant?: 'gradient' | 'outline-gradient';
}

/**
 * Starts the same Google OAuth flow as the login form; the callback
 * (`/auth/oauth`) redirects to `nextPath` once the session exists.
 */
export function GoogleOAuthButton({
  nextPath,
  label = 'Continue with Google',
  className,
  variant = 'gradient',
}: GoogleOAuthButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/oauth?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        className="w-full"
        disabled={isLoading}
        onClick={handleClick}
      >
        <GoogleLogo />
        {label}
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
