import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ArrowRight } from 'lucide-react';

import { stripe } from '../../lib/stripe';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SuccessPageProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function Success({ searchParams }: SuccessPageProps) {
  const { session_id } = await searchParams;

  if (!session_id)
    throw new Error('Please provide a valid session_id (`cs_test_...`)');

  const session = await stripe.checkout.sessions.retrieve(session_id, {
    expand: ['line_items', 'payment_intent'],
  });

  if (session.status === 'open') {
    return redirect('/');
  }

  if (session.status === 'complete') {
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
                Your subscription is now active. You can start using all{' '}
                <b>Pro</b> features immediately.
              </p>
            </div>

            <div className="flex gap-2">
              <Button asChild className="flex-1" variant="gradient">
                <Link href="/">
                  Go to Dashboard
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
                href="/contact"
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
