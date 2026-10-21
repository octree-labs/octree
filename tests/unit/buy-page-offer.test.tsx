import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BuyPageClient } from '@/app/buy/buy-page-client';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { track } from '@/lib/analytics/track';

vi.mock('@/lib/requests/subscription', () => ({
  createCheckoutSession: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/components/icons/octree-logo', () => ({ OctreeLogo: () => null, OctreeWordmark: () => null }));

vi.mock('@/app/onboarding/components/feature-list', () => ({ FeatureList: () => null }));

const BANNER = /50% off your first month is applied at checkout/;

async function checkoutArgs() {
  fireEvent.click(screen.getByRole('button', { name: 'Get Octree Pro →' }));
  await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
  return vi.mocked(createCheckoutSession).mock.calls[0][0];
}

describe('/buy first-purchase auto offer', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('applies the auto offer when the URL names none', async () => {
    render(<BuyPageClient plan={null} offer={null} autoOffer="welcome50" />);

    expect(screen.getByRole('status')).toHaveTextContent(BANNER);
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('offer_banner_shown', { offer: 'welcome50', auto: true });
    expect(await checkoutArgs()).toEqual({ plan: 'monthly', source: 'buy', offer: 'welcome50' });
  });

  it('an explicit ?offer= wins (and is not reported as auto)', async () => {
    render(<BuyPageClient plan={null} offer="welcome50" autoOffer={null} />);

    expect(screen.getByRole('status')).toHaveTextContent(BANNER);
    expect(track).toHaveBeenCalledWith('offer_banner_shown', { offer: 'welcome50' });
    expect(await checkoutArgs()).toEqual({ plan: 'monthly', source: 'buy', offer: 'welcome50' });
  });

  it('renders exactly the no-offer page for an ineligible user', () => {
    const { container: withoutProp } = render(<BuyPageClient plan={null} />);
    const before = withoutProp.innerHTML;
    cleanup();
    const { container: ineligible } = render(<BuyPageClient plan={null} offer={null} autoOffer={null} />);

    expect(ineligible.innerHTML).toBe(before);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  it('checks out at full price without an offer', async () => {
    render(<BuyPageClient plan={null} offer={null} autoOffer={null} />);
    expect(await checkoutArgs()).toEqual({ plan: 'monthly', source: 'buy' });
  });

  it('passes the auto offer to a ?plan=monthly deep link', async () => {
    render(<BuyPageClient plan="monthly" offer={null} autoOffer="welcome50" />);
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCheckoutSession).mock.calls[0][0]).toEqual({
      plan: 'monthly',
      source: 'buy',
      offer: 'welcome50',
    });
  });
});
