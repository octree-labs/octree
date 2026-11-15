import {
  CREDIT_PACKS,
  PRO_PLANS,
  type ProPlanId,
} from '@/data/constants';
import { formatUsd, regionalAmountCents, type PriceTier } from '@/lib/regional-pricing';

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
}

function money(cents: number) {
  return { amount: cents / 100, price: formatUsd(cents) };
}

export function pricingCatalog(tier: PriceTier): PricingCatalog {
  const monthly = money(regionalAmountCents('monthly', tier));
  const annualCents = regionalAmountCents('annual', tier);
  const annual = money(annualCents);
  const semester = money(regionalAmountCents('semester', tier));
  const credits = money(regionalAmountCents('credits_100', tier));
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
    exportSingle: { ...money(regionalAmountCents('export_single', tier)) },
    generateSingle: { ...money(regionalAmountCents('generate_single', tier)) },
  };
}

/** The list-price catalog: what the UI shows until the tier is known. */
export const STANDARD_PRICING = pricingCatalog('standard');

