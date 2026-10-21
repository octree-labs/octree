import { describe, it, expect, vi } from 'vitest';

import { selectBillingFollowUps, PAYMENT_FAILED_REMINDER_DELAY_MS } from '@/lib/lifecycle/billing-recovery';
import { PAYMENT_FAILED_SWEEP_LIST_CAP, runBillingFollowUps } from '@/lib/lifecycle/billing-send';
import type { LifecycleSendDeps } from '@/lib/lifecycle/send';

/**
 * The payment_failed sweep in runBillingFollowUps: the webhook only sends
 * the notice on the update that moves a subscription into past_due, so a
 * subscription that was already past_due (or whose event was missed) is
 * caught by the daily cron instead, through the same send path and ledger.
 */

type Invoice = { id: string; status: string; amount_due: number; amount_remaining?: number };
type Sub = {
  id: string;
  status: 'past_due' | 'unpaid' | 'active';
  latest_invoice: Invoice | string | null;
  metadata?: Record<string, string>;
  pause_collection?: { behavior: string } | null;
  cancel_at_period_end?: boolean;
};

function invoice(id: string, status = 'open', amount = 999): Invoice {
  return { id, status, amount_due: amount, amount_remaining: amount };
}

function fakeStripe(subs: Sub[]) {
  const list = vi.fn(async (params: { status: string; limit: number; starting_after?: string }) => {
    const all = subs.filter((s) => s.status === params.status);
    const start = params.starting_after ? all.findIndex((s) => s.id === params.starting_after) + 1 : 0;
    const data = all.slice(start, start + params.limit);
    return { data, has_more: start + data.length < all.length };
  });
  const byId = new Map(
    subs.flatMap((s) => (s.latest_invoice && typeof s.latest_invoice !== 'string' ? [[s.latest_invoice.id, s.latest_invoice] as const] : []))
  );
  const retrieveInvoice = vi.fn(async (id: string) => ({
    currency: 'usd',
    hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    next_payment_attempt: null,
    ...(byId.get(id) ?? { id, status: 'open', amount_due: 999 }),
  }));
  const retrieveSub = vi.fn(async (id: string) => subs.find((s) => s.id === id) ?? { id, status: 'canceled' });
  return {
    stripe: { invoices: { retrieve: retrieveInvoice }, subscriptions: { list, retrieve: retrieveSub } } as any,
    list,
    retrieveInvoice,
  };
}

interface LedgerRow {
  user_id: string;
  email: string;
  template: string;
  ref: string;
  payload: Record<string, unknown> | null;
  sent_at: string;
  resend_id: string | null;
  error: string | null;
  attempts?: number;
}

/** An in-memory lifecycle_emails ledger that the loader reads and deps write. */
function fakeWorld(options: {
  links: Record<string, string>;
  ledger?: LedgerRow[];
  mayEmail?: (userId: string) => boolean;
  clock: () => Date;
  /** Runs inside claim(), before the insert: simulates a concurrent writer (the webhook). */
  beforeClaim?: (ledger: LedgerRow[]) => void;
  /** The mailer's error for the next sends, if any. */
  mailError?: () => string | null;
}) {
  const ledger: LedgerRow[] = [...(options.ledger ?? [])];
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const key = (r: { user_id: string; template: string; ref: string }) => `${r.user_id}:${r.template}:${r.ref}`;

  const deps: LifecycleSendDeps = {
    mayEmail: async ({ userId }) => options.mayEmail?.(userId) ?? true,
    throttleMs: 0,
    mailer: {
      async send(input) {
        const error = options.mailError?.() ?? null;
        if (error) return { id: null, error };
        sent.push({ to: input.to, subject: input.subject, html: input.html });
        return { id: `msg_${sent.length}`, error: null };
      },
    },
    ledger: {
      // Insert, or on a unique violation take over a failed row with
      // attempts left, as claim_lifecycle_retry does (sent_at moves to now).
      async claim({ userId, email, template, ref, payload }) {
        options.beforeClaim?.(ledger);
        const row = { user_id: userId, template, ref };
        const existing = ledger.find((r) => key(r) === key(row));
        if (existing) {
          const attempts = existing.attempts ?? 1;
          if (existing.resend_id !== null || existing.error === null || attempts >= 3) return false;
          Object.assign(existing, { error: null, attempts: attempts + 1, sent_at: options.clock().toISOString(), email });
          return true;
        }
        ledger.push({ ...row, email, payload: payload ?? null, sent_at: options.clock().toISOString(), resend_id: null, error: null, attempts: 1 });
        return true;
      },
      async markSent({ userId, template, ref, resendId }) {
        const row = ledger.find((r) => key(r) === key({ user_id: userId, template, ref }));
        if (row) row.resend_id = resendId;
      },
      async markFailed({ userId, template, ref, error }) {
        const row = ledger.find((r) => key(r) === key({ user_id: userId, template, ref }));
        if (row) row.error = error;
      },
      async markSkipped({ userId, email, template, ref, reason, payload }) {
        const row = { user_id: userId, template, ref };
        if (ledger.some((r) => key(r) === key(row))) return;
        ledger.push({ ...row, email, payload: payload ?? null, sent_at: options.clock().toISOString(), resend_id: null, error: `skipped: ${reason}`, attempts: 3 });
      },
    },
    appUrl: 'https://app.example.com',
    toolsUrl: 'https://tools.example.com',
    unsubscribeUrl: (userId) => `https://app.example.com/u/${userId}`,
  };

  const usageIn = vi.fn(async (_column: string, ids: string[]) => ({
    data: ids.filter((id) => options.links[id]).map((id) => ({ user_id: options.links[id], stripe_subscription_id: id })),
    error: null,
  }));

  const supabase = {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@Example.com` } }, error: null }) } },
    from: (table: string) => {
      if (table === 'user_usage') return { select: () => ({ in: usageIn }) };
      if (table === 'lifecycle_emails') {
        const chain: any = {
          select: () => chain,
          in: () => chain,
          order: () => chain,
          limit: async () => ({ data: ledger.map((r) => ({ ...r })), error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;

  return { deps, supabase, ledger, sent, usageIn };
}

const t0 = Date.UTC(2026, 9, 21, 14, 30);
const DAY = 24 * 3600 * 1000;

describe('payment_failed sweep', () => {
  it('sends the notice for a past_due subscription with an open invoice and no ledger row', async () => {
    const { stripe, list } = fakeStripe([{ id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') }]);
    const world = fakeWorld({ links: { sub_1: 'u1' }, clock: () => new Date(t0) });
    const onPaymentFailedSent = vi.fn();

    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0), onPaymentFailedSent });

    expect(summary.payment_failed_sweep).toEqual({ candidates: 1, due: 1, sent: 1, skipped: 0, truncated: false });
    expect(world.sent).toHaveLength(1);
    expect(world.sent[0]).toMatchObject({ to: 'u1@example.com', subject: "Your Octree Pro payment didn't go through" });
    expect(world.sent[0].html).toContain('https://invoice.stripe.com/i/in_1');
    expect(world.ledger).toEqual([
      expect.objectContaining({ user_id: 'u1', template: 'payment_failed', ref: 'in_1', resend_id: 'msg_1', payload: expect.objectContaining({ subscription_id: 'sub_1', invoice_id: 'in_1' }) }),
    ]);
    expect(onPaymentFailedSent).toHaveBeenCalledWith('u1', expect.objectContaining({ invoiceId: 'in_1', amountCents: 999 }));
    // One list call per status, the invoice expanded.
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls.map((c) => c[0].status)).toEqual(['past_due', 'unpaid']);
    expect(list.mock.calls[0][0]).toMatchObject({ expand: ['data.latest_invoice'] });
  });

  it('is idempotent: a second run sends nothing, and a row from the webhook blocks it too', async () => {
    const { stripe } = fakeStripe([
      { id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') },
      { id: 'sub_2', status: 'unpaid', latest_invoice: invoice('in_2') },
    ]);
    const world = fakeWorld({
      links: { sub_1: 'u1', sub_2: 'u2' },
      ledger: [
        { user_id: 'u2', email: 'u2@example.com', template: 'payment_failed', ref: 'in_2', payload: { subscription_id: 'sub_2' }, sent_at: new Date(t0 - DAY).toISOString(), resend_id: 'msg_old', error: null },
      ],
      clock: () => new Date(t0),
    });

    const first = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(first.payment_failed_sweep).toEqual({ candidates: 2, due: 1, sent: 1, skipped: 1, truncated: false });

    const second = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0 + 3600 * 1000) });
    expect(second.payment_failed_sweep).toEqual({ candidates: 2, due: 0, sent: 0, skipped: 2, truncated: false });
    expect(world.sent).toHaveLength(1);
  });

  it('skips paid, void, draft and zero-amount invoices, unlinked subscriptions and suppressed users', async () => {
    const { stripe, retrieveInvoice } = fakeStripe([
      { id: 'sub_paid', status: 'past_due', latest_invoice: invoice('in_paid', 'paid') },
      { id: 'sub_void', status: 'past_due', latest_invoice: invoice('in_void', 'void') },
      { id: 'sub_draft', status: 'unpaid', latest_invoice: invoice('in_draft', 'draft') },
      { id: 'sub_zero', status: 'past_due', latest_invoice: invoice('in_zero', 'open', 0) },
      { id: 'sub_none', status: 'past_due', latest_invoice: null },
      { id: 'sub_unlinked', status: 'past_due', latest_invoice: invoice('in_unlinked') },
      { id: 'sub_suppressed', status: 'past_due', latest_invoice: invoice('in_suppressed') },
    ]);
    const world = fakeWorld({
      links: { sub_paid: 'u1', sub_void: 'u2', sub_draft: 'u3', sub_zero: 'u4', sub_none: 'u5', sub_suppressed: 'u7' },
      mayEmail: (userId) => userId !== 'u7',
      clock: () => new Date(t0),
    });

    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toEqual({ candidates: 2, due: 1, sent: 0, skipped: 2, truncated: false });
    expect(summary.failures).toEqual([]);
    expect(world.sent).toHaveLength(0);
    // Consent is checked before the claim: a suppressed user leaves no row.
    expect(world.ledger).toEqual([]);
    // Only the linked candidate got the send path's invoice read.
    expect(retrieveInvoice.mock.calls.map((c) => c[0])).toEqual(['in_suppressed']);
  });

  it('leaves a recovered (active) subscription alone', async () => {
    const { stripe } = fakeStripe([{ id: 'sub_1', status: 'active', latest_invoice: invoice('in_1') }]);
    const world = fakeWorld({ links: { sub_1: 'u1' }, clock: () => new Date(t0) });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ candidates: 0, sent: 0 });
    expect(world.sent).toHaveLength(0);
    expect(world.usageIn).not.toHaveBeenCalled();
  });

  it('a dry run sends and writes nothing, and reports the counts and the first subscription ids', async () => {
    const { stripe, retrieveInvoice } = fakeStripe([
      { id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') },
      { id: 'sub_2', status: 'unpaid', latest_invoice: invoice('in_2') },
      { id: 'sub_3', status: 'past_due', latest_invoice: invoice('in_3') },
    ]);
    const world = fakeWorld({ links: { sub_1: 'u1', sub_2: 'u2' }, clock: () => new Date(t0) });

    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0), dry: true });
    expect(summary.payment_failed_sweep).toEqual({
      candidates: 3,
      due: 2,
      sent: 0,
      skipped: 1,
      truncated: false,
      first_subscription_ids: ['sub_1', 'sub_2'],
    });
    expect(world.sent).toHaveLength(0);
    expect(world.ledger).toEqual([]);
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });

  it('pages through Stripe and flags truncation past the cap', async () => {
    const many: Sub[] = Array.from({ length: PAYMENT_FAILED_SWEEP_LIST_CAP + 5 }, (_, i) => ({
      id: `sub_${String(i).padStart(3, '0')}`,
      status: i % 2 ? 'unpaid' : 'past_due',
      latest_invoice: invoice(`in_${i}`),
    }));
    const { stripe, list } = fakeStripe(many);
    const world = fakeWorld({ links: {}, clock: () => new Date(t0) });

    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0), dry: true });
    expect(summary.payment_failed_sweep.candidates).toBe(PAYMENT_FAILED_SWEEP_LIST_CAP);
    expect(summary.payment_failed_sweep.truncated).toBe(true);
    // 53 past_due fit on one page; unpaid gets the remaining 47.
    expect(list.mock.calls.map((c) => [c[0].status, c[0].limit])).toEqual([
      ['past_due', 100],
      ['unpaid', 47],
    ]);

    const small = fakeStripe(many.slice(0, 3));
    const ok = await runBillingFollowUps({ stripe: small.stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0), dry: true });
    expect(ok.payment_failed_sweep.truncated).toBe(false);
  });

  it('follows has_more with starting_after', async () => {
    const subs: Sub[] = Array.from({ length: 3 }, (_, i) => ({ id: `sub_${i}`, status: 'past_due', latest_invoice: invoice(`in_${i}`) }));
    const { stripe } = fakeStripe(subs);
    const pages: any[] = [];
    const list = vi.fn(async (params: any) => {
      pages.push(params);
      const start = params.starting_after ? subs.findIndex((s) => s.id === params.starting_after) + 1 : 0;
      if (params.status !== 'past_due') return { data: [], has_more: false };
      const data = subs.slice(start, start + 2);
      return { data, has_more: start + data.length < subs.length };
    });
    stripe.subscriptions.list = list;
    const world = fakeWorld({ links: {}, clock: () => new Date(t0) });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0), dry: true });
    expect(summary.payment_failed_sweep.candidates).toBe(3);
    expect(pages.filter((p) => p.status === 'past_due').map((p) => p.starting_after)).toEqual([undefined, 'sub_1']);
  });

  it('a Stripe error in the sweep is reported and the follow-ups still run', async () => {
    const { stripe } = fakeStripe([]);
    stripe.subscriptions.list = vi.fn(async () => {
      throw new Error('stripe down');
    });
    const world = fakeWorld({ links: {}, clock: () => new Date(t0) });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.failures).toEqual([expect.objectContaining({ template: 'payment_failed', reason: 'stripe down' })]);
    expect(summary.payment_failed_reminder).toEqual({ due: 0, sent: 0, skipped: 0 });
  });

  it('the reminder becomes due 5 days after a sweep-sent notice and goes out while the invoice is open', async () => {
    let clock = new Date(t0);
    const { stripe } = fakeStripe([{ id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') }]);
    const world = fakeWorld({ links: { sub_1: 'u1' }, clock: () => clock });

    await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(world.sent.map((s) => s.subject)).toEqual(["Your Octree Pro payment didn't go through"]);

    const asRows = () =>
      world.ledger.map((r) => ({ userId: r.user_id, email: r.email, template: r.template, ref: r.ref, payload: r.payload, sentAt: r.sent_at, resendId: r.resend_id, error: r.error }));
    expect(selectBillingFollowUps(asRows(), new Date(t0 + PAYMENT_FAILED_REMINDER_DELAY_MS - 60_000))).toEqual([]);

    clock = new Date(t0 + 4 * DAY);
    const early = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(early.payment_failed_reminder.due).toBe(0);
    expect(early.payment_failed_sweep.sent).toBe(0);

    clock = new Date(t0 + PAYMENT_FAILED_REMINDER_DELAY_MS);
    const due = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(due.payment_failed_reminder).toEqual({ due: 1, sent: 1, skipped: 0 });
    expect(due.payment_failed_sweep.sent).toBe(0);
    expect(world.sent.map((s) => s.subject)).toEqual([
      "Your Octree Pro payment didn't go through",
      'Reminder: Octree Pro payment still failing',
    ]);
  });
  it('falls back to subscription.metadata.user_id when no user_usage row points at the subscription; user_usage wins when both exist', async () => {
    const { stripe } = fakeStripe([
      // u_old's row moved on to a newer subscription; the webhook would still send to the metadata user.
      { id: 'sub_meta', status: 'past_due', latest_invoice: invoice('in_meta'), metadata: { user_id: 'u_meta' } },
      { id: 'sub_both', status: 'past_due', latest_invoice: invoice('in_both'), metadata: { user_id: 'u_stale' } },
      { id: 'sub_blank', status: 'past_due', latest_invoice: invoice('in_blank'), metadata: { user_id: '' } },
    ]);
    const world = fakeWorld({ links: { sub_both: 'u_usage' }, clock: () => new Date(t0) });

    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ candidates: 3, due: 2, sent: 2, skipped: 1 });
    expect(world.sent.map((m) => m.to).sort()).toEqual(['u_meta@example.com', 'u_usage@example.com']);
    expect(world.ledger.map((r) => `${r.user_id}:${r.ref}`).sort()).toEqual(['u_meta:in_meta', 'u_usage:in_both']);
  });

  it('a notice row for the invoice under any user blocks the sweep, so a mapping disagreement cannot double-send', async () => {
    const { stripe } = fakeStripe([{ id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1'), metadata: { user_id: 'u_meta' } }]);
    const world = fakeWorld({
      links: { sub_1: 'u_usage' },
      ledger: [
        { user_id: 'u_meta', email: 'u_meta@example.com', template: 'payment_failed', ref: 'in_1', payload: { subscription_id: 'sub_1' }, sent_at: new Date(t0 - DAY).toISOString(), resend_id: 'msg_webhook', error: null, attempts: 1 },
      ],
      clock: () => new Date(t0),
    });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ candidates: 1, due: 0, sent: 0 });
    expect(world.sent).toHaveLength(0);
  });

  it('skips a paused subscription, an unexpanded or uncollectible invoice, and an open invoice with nothing remaining; keeps cancel_at_period_end', async () => {
    const { stripe } = fakeStripe([
      { id: 'sub_paused', status: 'past_due', latest_invoice: invoice('in_paused'), pause_collection: { behavior: 'void' } },
      { id: 'sub_string', status: 'past_due', latest_invoice: 'in_string' },
      { id: 'sub_uncollectible', status: 'unpaid', latest_invoice: invoice('in_uncollectible', 'uncollectible') },
      { id: 'sub_partial', status: 'past_due', latest_invoice: { id: 'in_partial', status: 'open', amount_due: 999, amount_remaining: 0 } },
      { id: 'sub_cancelling', status: 'past_due', latest_invoice: invoice('in_cancelling'), cancel_at_period_end: true },
    ]);
    const world = fakeWorld({
      links: { sub_paused: 'u1', sub_string: 'u2', sub_uncollectible: 'u3', sub_partial: 'u4', sub_cancelling: 'u5' },
      clock: () => new Date(t0),
    });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ candidates: 1, due: 1, sent: 1 });
    expect(world.sent.map((m) => m.to)).toEqual(['u5@example.com']);
  });

  it('loses the race to a concurrent webhook send: the claim refuses and nothing goes out twice', async () => {
    const { stripe } = fakeStripe([{ id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') }]);
    let raced = false;
    const world = fakeWorld({
      links: { sub_1: 'u1' },
      clock: () => new Date(t0),
      // The webhook claims (user, payment_failed, in_1) after the sweep loaded the ledger.
      beforeClaim: (ledger) => {
        if (raced) return;
        raced = true;
        ledger.push({ user_id: 'u1', email: 'u1@example.com', template: 'payment_failed', ref: 'in_1', payload: null, sent_at: new Date(t0).toISOString(), resend_id: null, error: null, attempts: 1 });
      },
    });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ due: 1, sent: 0, skipped: 1 });
    expect(summary.failures).toEqual([]);
    expect(world.sent).toHaveLength(0);
    expect(world.ledger).toHaveLength(1);
  });

  it('retries a failed notice up to the attempt cap, and the reminder counts from the retry that went out', async () => {
    let clock = new Date(t0);
    let failing = true;
    const { stripe } = fakeStripe([{ id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') }]);
    const world = fakeWorld({ links: { sub_1: 'u1' }, clock: () => clock, mailError: () => (failing ? 'resend 500' : null) });

    const first = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(first.payment_failed_sweep).toMatchObject({ due: 1, sent: 0 });
    expect(first.failures).toEqual([expect.objectContaining({ ref: 'in_1', reason: 'resend 500' })]);
    expect(world.ledger[0]).toMatchObject({ attempts: 1, error: 'resend 500', resend_id: null });

    clock = new Date(t0 + 2 * DAY);
    failing = false;
    const second = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(second.payment_failed_sweep).toMatchObject({ due: 1, sent: 1 });
    expect(world.ledger[0]).toMatchObject({ attempts: 2, error: null, resend_id: 'msg_1', sent_at: clock.toISOString() });

    // 5 days after the first (failed) attempt is too early: the notice went out on day 2.
    clock = new Date(t0 + PAYMENT_FAILED_REMINDER_DELAY_MS);
    const early = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(early.payment_failed_reminder.due).toBe(0);
    clock = new Date(t0 + 2 * DAY + PAYMENT_FAILED_REMINDER_DELAY_MS);
    const onTime = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: clock });
    expect(onTime.payment_failed_reminder).toMatchObject({ due: 1, sent: 1 });
  });

  it('a notice out of attempts, or closed as skipped, is not due again', async () => {
    const { stripe, retrieveInvoice } = fakeStripe([
      { id: 'sub_1', status: 'past_due', latest_invoice: invoice('in_1') },
      { id: 'sub_2', status: 'past_due', latest_invoice: invoice('in_2') },
    ]);
    const old = new Date(t0 - DAY).toISOString();
    const world = fakeWorld({
      links: { sub_1: 'u1', sub_2: 'u2' },
      ledger: [
        { user_id: 'u1', email: 'u1@example.com', template: 'payment_failed', ref: 'in_1', payload: null, sent_at: old, resend_id: null, error: 'resend 500', attempts: 3 },
        { user_id: 'u2', email: 'u2@example.com', template: 'payment_failed', ref: 'in_2', payload: null, sent_at: old, resend_id: null, error: 'skipped: x', attempts: 3 },
      ],
      clock: () => new Date(t0),
    });
    const summary = await runBillingFollowUps({ stripe, supabase: world.supabase, deps: world.deps, now: new Date(t0) });
    expect(summary.payment_failed_sweep).toMatchObject({ candidates: 2, due: 0, sent: 0 });
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });
});
