import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resolveStripeCustomer } from '@/lib/stripe-customer';
import { stripe } from '@/lib/stripe';

vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { list: vi.fn(), retrieve: vi.fn() },
    subscriptions: { list: vi.fn() },
  },
}));

// The persist step must go through the service-role client: the user_usage
// guard trigger rejects a stripe_customer_id change from the user session.
const admin = vi.hoisted(() => {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, update, updateEq };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: admin.from }),
}));

const customersList = vi.mocked(stripe.customers.list);
const customersRetrieve = vi.mocked(stripe.customers.retrieve);
const subscriptionsList = vi.mocked(stripe.subscriptions.list);

function makeSupabase(storedCustomerId: string | null | undefined) {
  // The user-session client is read-only here; `update` / `updateEq` are the
  // admin client's, so the existing assertions pin the write to that client.
  const userUpdate = vi.fn();
  const { update, updateEq } = admin;

  const maybeSingle = vi.fn().mockResolvedValue({
    // undefined = no user_usage row at all
    data: storedCustomerId === undefined ? null : { stripe_customer_id: storedCustomerId },
    error: null,
  });
  const selectEq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: selectEq });

  const from = vi.fn().mockReturnValue({ select, update: userUpdate });
  return { client: { from } as any, update, updateEq, userUpdate };
}

function subsFor(map: Record<string, string[]>) {
  subscriptionsList.mockImplementation((async (params: any) => ({
    data: (map[params.customer] ?? []).map((status, i) => ({ id: `sub_${params.customer}_${i}`, status })),
  })) as any);
}

function stripeError(code: string, statusCode = 404) {
  return Object.assign(new Error(code), { code, statusCode, type: 'StripeInvalidRequestError' });
}

const user = { id: 'user-1', email: 'dup@example.com' };

describe('resolveStripeCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customersRetrieve.mockImplementation((async (id: string) => ({ id, object: 'customer' })) as any);
  });

  describe('stored user_usage.stripe_customer_id', () => {
    it('is used after a single existence check, without an email search', async () => {
      const { client, update } = makeSupabase('cus_stored');

      const result = await resolveStripeCustomer(client, user);

      expect(result).toEqual({ customerId: 'cus_stored', source: 'stored' });
      expect(customersRetrieve).toHaveBeenCalledWith('cus_stored');
      expect(customersList).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('falls back to the email search when the stored customer was deleted in Stripe', async () => {
      const { client, update } = makeSupabase('cus_deleted');
      customersRetrieve.mockResolvedValue({ id: 'cus_deleted', deleted: true } as any);
      customersList.mockResolvedValue({ data: [{ id: 'cus_new' }] } as any);
      subsFor({ cus_new: ['active'] });

      const result = await resolveStripeCustomer(client, user);

      expect(result).toEqual({ customerId: 'cus_new', source: 'email' });
      expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_new' });
    });

    it('falls back to the email search when Stripe has never seen the stored id', async () => {
      const { client } = makeSupabase('cus_bogus');
      customersRetrieve.mockRejectedValue(stripeError('resource_missing'));
      customersList.mockResolvedValue({ data: [{ id: 'cus_real' }] } as any);
      subsFor({ cus_real: [] });

      await expect(resolveStripeCustomer(client, user)).resolves.toEqual({
        customerId: 'cus_real',
        source: 'email',
      });
    });

    it('returns null when the stored customer is gone and the email has no customers', async () => {
      const { client, update } = makeSupabase('cus_deleted');
      customersRetrieve.mockResolvedValue({ id: 'cus_deleted', deleted: true } as any);
      customersList.mockResolvedValue({ data: [] } as any);

      await expect(resolveStripeCustomer(client, user)).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('rethrows other Stripe errors from the existence check (callers handle them as before)', async () => {
      const { client } = makeSupabase('cus_stored');
      customersRetrieve.mockRejectedValue(stripeError('rate_limit', 429));

      await expect(resolveStripeCustomer(client, user)).rejects.toMatchObject({ code: 'rate_limit' });
      expect(customersList).not.toHaveBeenCalled();
    });
  });

  describe('email search', () => {
    it('finds a single customer and persists the id when it has a live subscription', async () => {
      const { client, update, updateEq } = makeSupabase(null);
      customersList.mockResolvedValue({ data: [{ id: 'cus_only' }] } as any);
      subsFor({ cus_only: ['active'] });

      const result = await resolveStripeCustomer(client, user);

      expect(result).toEqual({ customerId: 'cus_only', source: 'email' });
      expect(customersList).toHaveBeenCalledWith({ email: 'dup@example.com', limit: 100 });
      expect(customersRetrieve).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_only' });
      expect(updateEq).toHaveBeenCalledWith('user_id', 'user-1');
    });

    it('persists through the service-role client, never the user session', async () => {
      const { client, update, userUpdate } = makeSupabase(null);
      customersList.mockResolvedValue({ data: [{ id: 'cus_only' }] } as any);
      subsFor({ cus_only: ['active'] });

      await resolveStripeCustomer(client, user);

      expect(admin.from).toHaveBeenCalledWith('user_usage');
      expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_only' });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('works when the user has no user_usage row yet', async () => {
      const { client, update } = makeSupabase(undefined);
      customersList.mockResolvedValue({ data: [{ id: 'cus_only' }] } as any);
      subsFor({ cus_only: ['trialing'] });

      await expect(resolveStripeCustomer(client, user)).resolves.toEqual({
        customerId: 'cus_only',
        source: 'email',
      });
      expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_only' });
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

    it('picks the older duplicate when it is the one holding the active subscription', async () => {
      const { client, update } = makeSupabase(null);
      customersList.mockResolvedValue({ data: [{ id: 'cus_new_nosub' }, { id: 'cus_old_active' }] } as any);
      subsFor({ cus_new_nosub: [], cus_old_active: ['active'] });

      await expect(resolveStripeCustomer(client, user)).resolves.toEqual({
        customerId: 'cus_old_active',
        source: 'email',
      });
      expect(update).toHaveBeenCalledWith({ stripe_customer_id: 'cus_old_active' });
    });

    it('returns the newest customer without persisting when none has a live subscription', async () => {
      // Same pick as the pre-PR `customers.list({ email, limit: 1 })`.
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

    it('returns null without calling Stripe when the user has no email and no stored id', async () => {
      const { client } = makeSupabase(null);

      await expect(resolveStripeCustomer(client, { id: 'user-1', email: null })).resolves.toBeNull();
      expect(customersList).not.toHaveBeenCalled();
    });

    it('propagates a Stripe error from the email search', async () => {
      const { client } = makeSupabase(null);
      customersList.mockRejectedValue(stripeError('api_error', 500));

      await expect(resolveStripeCustomer(client, user)).rejects.toMatchObject({ code: 'api_error' });
    });
  });
});
