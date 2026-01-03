import 'server-only';

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not defined');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
