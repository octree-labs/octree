const isProduction = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');

export const STRIPE_PRICE_IDS = {
  pro: isProduction
    ? 'price_1SljeIGiQyLSHGp2218XpKqY'
    : 'price_1SlcAwGiQyLSHGp20kQ1Maq3',
  proAnnual: isProduction
    ? 'price_1Sk6yqGiQyLSHGp2KE9FeLIV'
    : 'price_1Sm1xOGiQyLSHGp2h5H1FrDN',
} as const;

export type StripePriceType = keyof typeof STRIPE_PRICE_IDS;
