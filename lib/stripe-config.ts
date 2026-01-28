// Determine if we're in production mode
const getStripeSecretKey = (): string | undefined => {
  // First, check if STRIPE_SECRET_KEY is directly set (for backward compatibility)
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  // Otherwise, use environment-specific keys
  const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
  const isProduction = environment === 'prod' || environment === 'production';

  if (isProduction) {
    return process.env.STRIPE_PROD_SECRET_KEY;
  } else {
    return process.env.STRIPE_TEST_SECRET_KEY;
  }
};

const stripeKey = getStripeSecretKey();
const isProduction =
  process.env.ENVIRONMENT === 'prod' ||
  process.env.ENVIRONMENT === 'production' ||
  process.env.NODE_ENV === 'production' ||
  stripeKey?.startsWith('sk_live_');

export const STRIPE_PRICE_IDS = {
  pro: isProduction
    ? 'price_1SrStMGiQyLSHGp2VHT7Amjv'
    : 'price_1SrSvUGiQyLSHGp2SlUX8dFa',
  proAnnual: isProduction
    ? 'price_1SrT4OGiQyLSHGp24sw9t4Xf'
    : 'price_1SrT1VGiQyLSHGp2lFnKxgET',
} as const;

export type StripePriceType = keyof typeof STRIPE_PRICE_IDS;
