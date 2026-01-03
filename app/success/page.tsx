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
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <CardTitle className="text-2xl font-bold">
              Payment Successful!
            </CardTitle>
            <CardDescription className="text-base">
              Thank you for your purchase
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg bg-neutral-50 p-4 text-center">
              <p className="text-sm text-neutral-600">
                Your subscription is now active. You can start using all Pro
                features immediately.
              </p>
            </div>

            <div className="space-y-3">
              <Button asChild className="w-full">
                <Link href="/">
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
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
