import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOfferVariant } from '@/lib/offer-v2/variant-server';
import { offerDeadline, type OfferResponse } from '@/lib/offer-v2/offer';
import { projectsCreatedLastWeek } from '@/lib/offer-v2/proof-server';
import { firstPurchaseOfferForUser } from '@/lib/first-purchase-offer-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/offer: which paywall this user sees (`onboarding-offer-v2`,
 * lib/offer-v2/variant-server.ts) and, for `offer_v2`, what it shows:
 *
 * - `deadline`: the first-purchase offer (welcome50, 50% off the first
 *   month) with its real end, sign-up + 48 h, only while the user is
 *   eligible by the existing rule (lib/first-purchase-offer.ts: never bought
 *   anything) and the 48 h have not passed. Null otherwise: no countdown.
 * - `proof`: projects created on Octree in the last 7 days (cached hourly).
 *
 * `control` answers with the variant only (no extra queries). Never fails
 * the page: an error is `control`.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const variant = await getOfferVariant(user.id);
    if (variant !== 'offer_v2') {
      return NextResponse.json({ variant } satisfies OfferResponse);
    }

    const now = new Date();
    const endsAt = offerDeadline(user.created_at, now);
    const [offer, count] = await Promise.all([
      endsAt ? firstPurchaseOfferForUser(supabase, createAdminClient, user, now) : Promise.resolve(null),
      projectsCreatedLastWeek(createAdminClient(), now.getTime()),
    ]);

    const body: OfferResponse = {
      variant,
      deadline: endsAt && offer === 'welcome50' ? { offer, endsAt: endsAt.toISOString() } : null,
      proof: count !== null ? { count } : null,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/offer] failed; answering control:', error);
    return NextResponse.json({ variant: 'control' } satisfies OfferResponse);
  }
}
