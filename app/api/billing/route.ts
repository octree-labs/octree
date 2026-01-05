import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

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

    // Try multiple methods to find the customer
    let customer = null;
    
    // Method 1: Try to find by email
    try {
      const customersByEmail = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });
      
      if (customersByEmail.data.length > 0) {
        customer = customersByEmail.data[0];
      }
    } catch (error) {
      console.log('No customer found by email:', user.email);
    }

    // Method 2: If no customer by email, try to find by user ID in metadata
    if (!customer) {
      try {
        const customersByMetadata = await stripe.customers.list({
          limit: 100,
        });
        
        customer = customersByMetadata.data.find(c => 
          c.metadata?.user_id === user.id || 
          c.metadata?.supabase_user_id === user.id
        );
      } catch (error) {
        console.log('Error searching customers by metadata:', error);
      }
    }

    // If no customer exists, return empty billing data
    if (!customer) {
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
      customer: customer.id,
      limit: 10,
    });

    // Get payment methods for the customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: 'card',
    });

    // Get active subscription to determine next billing
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    const nextBilling = subscriptions.data.length > 0 
      ? subscriptions.data[0].current_period_end 
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