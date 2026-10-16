const isProduction = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');

export const STRIPE_PRICE_IDS = {
  pro: isProduction
    ? 'price_1SrStMGiQyLSHGp2VHT7Amjv'
    : 'price_1SrSvUGiQyLSHGp2SlUX8dFa',
  proAnnual: isProduction
    ? 'price_1SrT4OGiQyLSHGp24sw9t4Xf'
    : 'price_1SrT1VGiQyLSHGp2lFnKxgET',
} as const;

export type StripePriceType = keyof typeof STRIPE_PRICE_IDS;
