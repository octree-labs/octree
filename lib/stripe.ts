import 'server-only';

import Stripe from 'stripe';

// Determine which Stripe key to use based on environment
const getStripeSecretKey = (): string => {
  // First, check if STRIPE_SECRET_KEY is directly set (for backward compatibility)
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  // Otherwise, use environment-specific keys
  const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
  const isProduction = environment === 'prod' || environment === 'production';

  if (isProduction) {
    if (!process.env.STRIPE_PROD_SECRET_KEY) {
      throw new Error(
        'STRIPE_PROD_SECRET_KEY environment variable is not defined for production environment'
      );
    }
    return process.env.STRIPE_PROD_SECRET_KEY;
  } else {
    if (!process.env.STRIPE_TEST_SECRET_KEY) {
      throw new Error(
        'STRIPE_TEST_SECRET_KEY environment variable is not defined for development environment'
      );
    }
    return process.env.STRIPE_TEST_SECRET_KEY;
  }
};

const stripeSecretKey = getStripeSecretKey();

export const stripe = new Stripe(stripeSecretKey);
