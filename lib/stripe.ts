import 'server-only';

import Stripe from 'stripe';

function getStripeSecretKey(): string {
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }
  const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
  const isProduction = environment === 'prod' || environment === 'production';
  if (isProduction) {
    if (!process.env.STRIPE_PROD_SECRET_KEY) {
      throw new Error(
        'STRIPE_PROD_SECRET_KEY environment variable is not defined for production'
      );
    }
    return process.env.STRIPE_PROD_SECRET_KEY;
  }
  if (!process.env.STRIPE_TEST_SECRET_KEY) {
    throw new Error(
      'STRIPE_TEST_SECRET_KEY environment variable is not defined for development'
    );
  }
  return process.env.STRIPE_TEST_SECRET_KEY;
}

export const stripe = new Stripe(getStripeSecretKey());
