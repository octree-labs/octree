import { redirect } from 'next/navigation';
import type Stripe from 'stripe';
import Link from 'next/link';
import { CheckCircle, ArrowRight } from 'lucide-react';

import { stripe } from '../../lib/stripe';
import { resolveReturnPath } from '@/lib/checkout-plans';
import { isOctreeCheckoutSession } from '@/lib/stripe-webhook';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SuccessPageProps {
  searchParams: Promise<{ session_id?: string; next?: string }>;
}

export default async function Success({ searchParams }: SuccessPageProps) {
  const { session_id, next } = await searchParams;
  // Set by the onboarding paywall: the page the buyer was headed for.
  const continuePath = resolveReturnPath(next);

  if (!session_id)
    throw new Error('Please provide a valid session_id (`cs_test_...`)');

  const session = await stripe.checkout.sessions.retrieve(session_id, {
    expand: ['line_items', 'payment_intent'],
  });

  if (session.status === 'open') {
    return redirect('/');
  }

  if (session.status === 'complete') {
    await markOnboardedAfterPayment(session);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-neutral-50 to-neutral-100 p-4">
        <Card className="w-full max-w-lg py-8">
          <CardHeader className="pt-6 text-center">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <CardTitle className="text-xl font-bold">
                Payment Successful
              </CardTitle>
            </div>
            <CardDescription className="text-base">
              Thank you for your purchase
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg bg-neutral-50 p-4 text-center border">
              <p className="text-left text-sm text-neutral-600">
                {session.mode === 'payment' ? (
                  <>
                    <b>{session.metadata?.credits ?? '100'} AI edits</b> have been added to your
                    account. They never expire and are used once your plan&apos;s edits run out.
                  </>
                ) : (
                  <>
                    Your subscription is now active. You can start using all{' '}
                    <b>Pro</b> features immediately.
                  </>
                )}
              </p>
            </div>

            <div className="flex gap-2">
              <Button asChild className="flex-1" variant="gradient">
                <Link href={continuePath ?? '/'}>
                  {continuePath ? 'Continue' : 'Go to Dashboard'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline-gradient" className="flex-1">
                <Link href="/settings">View Subscription</Link>
              </Button>
            </div>

            <p className="text-center text-xs text-neutral-500">
              Need help?{' '}
              <Link
                href="/help"
                className="font-medium text-neutral-700 hover:underline"
              >
                Contact support
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
}

/**
 * The Stripe webhook sets onboarding_completed for a paid subscription, but
 * it can land after the buyer clicks on from here; under the onboarding
 * paywall (data/constants.ts) they would then be sent back to the plan step
 * and could pay twice. A completed, paid subscription session of Octree's
 * that belongs to the signed-in user is proof enough to set the same flag
 * now (the user's own session may write it: the free path does too). Never
 * throws; the webhook stays the source of truth for is_pro.
 */
async function markOnboardedAfterPayment(session: Stripe.Checkout.Session): Promise<void> {
  try {
    if (session.mode !== 'subscription' || session.payment_status === 'unpaid') return;
    if (!isOctreeCheckoutSession(session)) return;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || session.metadata?.user_id !== user.id) return;
    const { error } = await (supabase.from('user_usage') as any).upsert(
      { user_id: user.id, onboarding_completed: true },
      { onConflict: 'user_id' }
    );
    if (error) console.error('[success] could not mark onboarding completed:', error);
  } catch (error) {
    console.error('[success] could not mark onboarding completed:', error);
  }
}
