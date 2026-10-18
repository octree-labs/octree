import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { stripe } from '@/lib/stripe';

vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { list: vi.fn() },
    subscriptions: { list: vi.fn() },
  },
}));

const customersList = vi.mocked(stripe.customers.list);
const subscriptionsList = vi.mocked(stripe.subscriptions.list);

function makeSupabase(storedCustomerId: string | null) {
  const update = vi.fn();
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  update.mockReturnValue({ eq: updateEq });

  const maybeSingle = vi.fn().mockResolvedValue({
    data: storedCustomerId === undefined ? null : { stripe_customer_id: storedCustomerId },
    error: null,
  });
  const selectEq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: selectEq });

  const from = vi.fn().mockReturnValue({ select, update });
  return { client: { from } as any, update, updateEq };
}

function subsFor(map: Record<string, string[]>) {
  subscriptionsList.mockImplementation((async (params: any) => ({
    data: (map[params.customer] ?? []).map((status, i) => ({ id: `sub_${params.customer}_${i}`, status })),
  })) as any);
}

const user = { id: 'user-1', email: 'dup@example.com' };

describe('resolveStripeCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses user_usage.stripe_customer_id without touching Stripe when present', async () => {
    const { client } = makeSupabase('cus_stored');

    const result = await resolveStripeCustomer(client, user);

    expect(result).toEqual({ customerId: 'cus_stored', source: 'stored' });
    expect(customersList).not.toHaveBeenCalled();
  });

  it('falls back to the email search and persists the id when the customer has a live subscription', async () => {
    const { client, update, updateEq } = makeSupabase(null);
    customersList.mockResolvedValue({ data: [{ id: 'cus_only' }] } as any);
    subsFor({ cus_only: ['active'] });

    const result = await resolveStripeCustomer(client, user);

    expect(result).toEqual({ customerId: 'cus_only', source: 'email' });
    expect(customersList).toHaveBeenCalledWith({ email: 'dup@example.com', limit: 100 });
    expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_only' });
    expect(updateEq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('picks the newest duplicate customer with a non-canceled subscription, not the first result', async () => {
    const { client, update } = makeSupabase(null);
    // Stripe lists newest first; the newest object has only a canceled sub.
    customersList.mockResolvedValue({
      data: [{ id: 'cus_newest_canceled' }, { id: 'cus_live' }, { id: 'cus_oldest' }],
    } as any);
    subsFor({ cus_newest_canceled: ['canceled'], cus_live: ['past_due'], cus_oldest: ['canceled'] });

    const result = await resolveStripeCustomer(client, user);

    expect(result).toEqual({ customerId: 'cus_live', source: 'email' });
    expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_live' });
  });

  it('returns the newest customer without persisting when none has a live subscription', async () => {
    const { client, update } = makeSupabase(null);
    customersList.mockResolvedValue({ data: [{ id: 'cus_a' }, { id: 'cus_b' }] } as any);
    subsFor({ cus_a: ['canceled'], cus_b: [] });

    const result = await resolveStripeCustomer(client, user);

    expect(result).toEqual({ customerId: 'cus_a', source: 'email' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns null when the user has no Stripe customer', async () => {
    const { client } = makeSupabase(null);
    customersList.mockResolvedValue({ data: [] } as any);

    await expect(resolveStripeCustomer(client, user)).resolves.toBeNull();
  });
});
