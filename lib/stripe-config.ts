const isProduction = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');

export const STRIPE_PRICE_IDS = {
  pro: isProduction
    ? 'price_1SqiYyGiQyLSHGp2Tdy1FFCy'
    : 'price_1SlcAwGiQyLSHGp20kQ1Maq3',
  proAnnual: isProduction
    ? 'price_1SqiZzGiQyLSHGp2nYcdGQYL'
    : 'price_1Sm1xOGiQyLSHGp2h5H1FrDN',
} as const;

export type StripePriceType = keyof typeof STRIPE_PRICE_IDS;
