import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { subscriptionPeriod } from '@/lib/stripe-subscription';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let customerId: string | null = null;
    try {
      customerId = (await resolveStripeCustomer(supabase, user))?.customerId ?? null;
    } catch (error) {
      console.error('Error finding Stripe customer:', error);
    }

    // If no customer exists, return empty billing data
    if (!customerId) {
      return NextResponse.json({
        billingSummary: {
          totalPaid: 0,
          invoiceCount: 0,
          nextBilling: null,
        },
        invoices: [],
        paymentMethods: [],
      });
    }

    // Get invoices for the customer
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 10,
    });

    // Get payment methods for the customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    // Get active subscription to determine next billing
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    const nextBilling = subscriptions.data.length > 0
      ? subscriptionPeriod(subscriptions.data[0]).end
      : null;

    // Calculate total paid
    const totalPaid = invoices.data
      .filter(invoice => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + (invoice.amount_paid || 0), 0);

    return NextResponse.json({
      billingSummary: {
        totalPaid,
        invoiceCount: invoices.data.length,
        nextBilling,
      },
      invoices: invoices.data.map(invoice => ({
        id: invoice.id,
        date: invoice.created,
        amount: invoice.amount_paid || 0,
        status: invoice.status,
        description: invoice.description || `Invoice ${invoice.number}`,
        currency: invoice.currency,
      })),
      paymentMethods: paymentMethods.data.map(pm => ({
        id: pm.id,
        type: pm.type,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        } : null,
      })),
    });
  } catch (error) {
    console.error('Error fetching billing data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing data' },
      { status: 500 }
    );
  }
} 