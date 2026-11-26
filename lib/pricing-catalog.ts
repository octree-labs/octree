import {
  CREDIT_PACKS,
  DEADLINE_PASS_PRICE,
  EXPORT_SINGLE_PRICE,
  GENERATE_SINGLE_PRICE,
  PRO_PLANS,
  type ProPlanId,
} from '@/data/constants';
import {
  formatUsd,
  regionalAmountCents,
  type PriceTier,
  type RegionalPlan,
} from '@/lib/regional-pricing';

/**
 * The display copy for everything the app sells, at one price tier: the
 * same shape as PRO_PLANS / CREDIT_PACKS / EXPORT_SINGLE_PRICE /
 * GENERATE_SINGLE_PRICE in data/constants.ts with the amounts and the
 * strings that contain them replaced. `standard` returns the constants
 * unchanged.
 */

type ProPlanCopy = {
  [K in ProPlanId]: Omit<(typeof PRO_PLANS)[K], 'amount' | 'price' | 'billingNote'> & {
    amount: number;
    price: string;
    billingNote: string;
  };
};

export interface PricingCatalog {
  tier: PriceTier;
  proPlans: ProPlanCopy;
  creditPack: Omit<(typeof CREDIT_PACKS)['credits_100'], 'amount' | 'price' | 'label'> & {
    amount: number;
    price: string;
    label: string;
  };
  exportSingle: { amount: number; price: string };
  generateSingle: { amount: number; price: string };
  /** The Deadline Pass (DEADLINE_PASS_PRICE): days of Pro for a one-off price. */
  deadlinePass: { amount: number; price: string; days: number };
}

/** List prices, from the display constants (which match lib/stripe-prices.ts). */
const LIST_AMOUNTS: Record<RegionalPlan, number> = {
  monthly: PRO_PLANS.monthly.amount,
  annual: PRO_PLANS.annual.amount,
  semester: PRO_PLANS.semester.amount,
  credits_100: CREDIT_PACKS.credits_100.amount,
  generate_single: GENERATE_SINGLE_PRICE.amount,
  export_single: EXPORT_SINGLE_PRICE.amount,
  deadline_pass: DEADLINE_PASS_PRICE.amount,
};

function cents(plan: RegionalPlan, tier: PriceTier): number {
  return tier === 'standard' ? Math.round(LIST_AMOUNTS[plan] * 100) : regionalAmountCents(plan, tier);
}

function money(cents: number) {
  return { amount: cents / 100, price: formatUsd(cents) };
}

export function pricingCatalog(tier: PriceTier): PricingCatalog {
  const monthly = money(cents('monthly', tier));
  const annualCents = cents('annual', tier);
  const annual = money(annualCents);
  const semester = money(cents('semester', tier));
  const credits = money(cents('credits_100', tier));
  const pack = CREDIT_PACKS.credits_100;

  return {
    tier,
    proPlans: {
      monthly: { ...PRO_PLANS.monthly, ...monthly },
      annual: {
        ...PRO_PLANS.annual,
        ...annual,
        billingNote: `Just $${(annualCents / 1200).toFixed(2)} a month, billed yearly. Cancel anytime.`,
      },
      semester: { ...PRO_PLANS.semester, ...semester },
    },
    creditPack: {
      ...pack,
      ...credits,
      label: `${pack.credits} AI edits for ${credits.price}`,
    },
    exportSingle: { ...money(cents('export_single', tier)) },
    generateSingle: { ...money(cents('generate_single', tier)) },
    deadlinePass: { ...money(cents('deadline_pass', tier)), days: DEADLINE_PASS_PRICE.days },
  };
}

/** The list-price catalog: what the UI shows until the tier is known. */
export const STANDARD_PRICING = pricingCatalog('standard');

