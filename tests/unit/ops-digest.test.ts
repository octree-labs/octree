import { describe, it, expect } from 'vitest';

import {
  buildDailySeries,
  computeMrr,
  makeWindows,
  monthlyAmountCents,
  stripeTsInWindow,
  summarizeCheckouts,
  summarizeInvoices,
  summarizeRefunds,
  summarizeSubscriptions,
  type SubscriptionLike,
} from '@/lib/ops/digest';
import { digestSubject, formatMoney, renderDigestHtml, sparkline } from '@/lib/ops/digest-email';

// 2026-10-18T13:00:00Z, the digest's scheduled time.
const NOW = new Date('2026-10-18T13:00:00Z');
const windows = makeWindows(NOW);
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function sub(
  overrides: Partial<SubscriptionLike> & {
    amount?: number;
    interval?: 'day' | 'week' | 'month' | 'year';
    intervalCount?: number;
    quantity?: number;
  } = {}
): SubscriptionLike {
  const {
    amount = 1500,
    interval = 'month',
    intervalCount = 1,
    quantity = 1,
    currency = 'usd',
    ...rest
  } = overrides;
  return {
    id: 'sub_1',
    status: 'active',
    currency,
    created: sec('2026-10-01T00:00:00Z'),
    canceled_at: null,
    cancellation_details: null,
    items: {
      data: [
        {
          quantity,
          price: { unit_amount: amount, currency, recurring: { interval, interval_count: intervalCount } },
        },
      ],
    },
    ...rest,
  };
}

describe('makeWindows', () => {
  it('ends every window at the start of today (UTC) and spans whole days', () => {
    expect(new Date(windows.yesterday.end).toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(new Date(windows.yesterday.start).toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(new Date(windows.d7.start).toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(new Date(windows.d30.start).toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('treats the end as exclusive and the start as inclusive', () => {
    expect(stripeTsInWindow(sec('2026-10-17T00:00:00Z'), windows.yesterday)).toBe(true);
    expect(stripeTsInWindow(sec('2026-10-17T23:59:59Z'), windows.yesterday)).toBe(true);
    expect(stripeTsInWindow(sec('2026-10-18T00:00:00Z'), windows.yesterday)).toBe(false);
    expect(stripeTsInWindow(sec('2026-10-16T23:59:59Z'), windows.yesterday)).toBe(false);
    expect(stripeTsInWindow(null, windows.yesterday)).toBe(false);
  });
});

describe('MRR normalisation', () => {
  it('keeps monthly prices as-is and multiplies by quantity', () => {
    expect(monthlyAmountCents({ quantity: 3, price: { unit_amount: 1000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } })).toBe(3000);
  });

  it('divides annual prices by 12', () => {
    expect(monthlyAmountCents({ price: { unit_amount: 12000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } } })).toBe(1000);
  });

  it('normalises weekly prices to ~4.35 weeks per month', () => {
    const cents = monthlyAmountCents({ price: { unit_amount: 1000, currency: 'usd', recurring: { interval: 'week', interval_count: 1 } } });
    expect(cents).toBeCloseTo(4348.1, 0);
  });

  it('respects interval_count (e.g. every 3 months)', () => {
    expect(monthlyAmountCents({ price: { unit_amount: 3000, currency: 'usd', recurring: { interval: 'month', interval_count: 3 } } })).toBe(1000);
    expect(monthlyAmountCents({ price: { unit_amount: 24000, currency: 'usd', recurring: { interval: 'year', interval_count: 2 } } })).toBe(1000);
  });

  it('ignores one-off and amount-less prices', () => {
    expect(monthlyAmountCents({ price: { unit_amount: 1000, currency: 'usd', recurring: null } })).toBe(0);
    expect(monthlyAmountCents({ price: { unit_amount: null, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } })).toBe(0);
  });

  it('sums active + trialing only and keeps CAD separate from USD', () => {
    const mrr = computeMrr([
      sub({ id: 'a', amount: 1500 }),
      sub({ id: 'b', amount: 12000, interval: 'year', status: 'trialing' }),
      sub({ id: 'c', amount: 2000, currency: 'cad' }),
      sub({ id: 'd', amount: 9900, status: 'canceled' }),
      sub({ id: 'e', amount: 9900, status: 'past_due' }),
    ]);
    expect(mrr.usd).toBe(25);
    expect(mrr.cad).toBe(20);
    expect(mrr.byCurrency).toEqual({ usd: 25, cad: 20 });
    expect(mrr.activeCount).toBe(2);
    expect(mrr.trialingCount).toBe(1);
  });
});

describe('summarizeSubscriptions', () => {
  it('counts new subs and cancellations per window with reasons', () => {
    const subs = [
      sub({ id: 'new-yesterday', created: sec('2026-10-17T10:00:00Z') }),
      sub({ id: 'new-last-week', created: sec('2026-10-13T10:00:00Z') }),
      sub({ id: 'new-last-month', created: sec('2026-09-20T10:00:00Z') }),
      sub({ id: 'too-old', created: sec('2026-08-01T10:00:00Z') }),
      sub({ id: 'incomplete', created: sec('2026-10-17T10:00:00Z'), status: 'incomplete' }),
      sub({
        id: 'cancelled-yesterday',
        status: 'canceled',
        created: sec('2026-09-01T00:00:00Z'),
        canceled_at: sec('2026-10-17T12:00:00Z'),
        cancellation_details: { reason: 'cancellation_requested' },
      }),
      sub({
        id: 'cancelled-last-week',
        status: 'canceled',
        created: sec('2026-09-01T00:00:00Z'),
        canceled_at: sec('2026-10-12T12:00:00Z'),
        cancellation_details: { reason: 'payment_failed' },
      }),
      sub({ id: 'past-due', status: 'past_due', created: sec('2026-08-01T10:00:00Z') }),
    ];
    const s = summarizeSubscriptions(subs, windows);
    expect(s.newSubscriptions).toEqual({ yesterday: 1, d7: 2, d30: 3 });
    expect(s.cancellations.yesterday).toEqual({ count: 1, reasons: { cancellation_requested: 1 } });
    expect(s.cancellations.d7.count).toBe(2);
    expect(s.cancellations.d30.reasons).toEqual({ cancellation_requested: 1, payment_failed: 1 });
    expect(s.pastDueCount).toBe(1);
  });
});

describe('summarizeInvoices / refunds / checkouts', () => {
  it('sums gross by paid_at and detects recovered failures', () => {
    const invoices = [
      { id: 'in_a', status: 'paid', currency: 'usd', amount_paid: 1500, created: sec('2026-10-17T01:00:00Z'), status_transitions: { paid_at: sec('2026-10-17T01:00:00Z') } },
      { id: 'in_b', status: 'paid', currency: 'cad', amount_paid: 2000, created: sec('2026-10-15T01:00:00Z'), status_transitions: { paid_at: sec('2026-10-15T01:00:00Z') } },
      { id: 'in_c', status: 'open', currency: 'usd', amount_paid: 0, created: sec('2026-10-16T01:00:00Z'), status_transitions: { paid_at: null } },
      // Created before yesterday but paid yesterday: counts for yesterday.
      { id: 'in_d', status: 'paid', currency: 'usd', amount_paid: 500, created: sec('2026-10-10T01:00:00Z'), status_transitions: { paid_at: sec('2026-10-17T20:00:00Z') } },
    ];
    const failures = [
      { invoiceId: 'in_c', created: sec('2026-10-16T02:00:00Z') },
      { invoiceId: 'in_d', created: sec('2026-10-14T02:00:00Z') },
      { invoiceId: 'in_d', created: sec('2026-10-16T02:00:00Z') },
    ];
    const s = summarizeInvoices(invoices, failures, windows);
    expect(s.gross.yesterday).toEqual({ usd: 20 });
    expect(s.gross.d7).toEqual({ usd: 20, cad: 20 });
    expect(s.paidInvoices).toEqual({ yesterday: 2, d7: 3, d30: 3 });
    expect(s.failedAttempts).toEqual({ yesterday: 0, d7: 3, d30: 3 });
    expect(s.recovered).toEqual({ yesterday: 0, d7: 1, d30: 1 });
  });

  it('counts refunds and checkout sessions per window', () => {
    const refunds = summarizeRefunds(
      [
        { id: 're_1', amount: 1500, currency: 'usd', created: sec('2026-10-17T05:00:00Z') },
        { id: 're_2', amount: 1500, currency: 'usd', created: sec('2026-09-01T05:00:00Z') },
      ],
      windows
    );
    expect(refunds.count).toEqual({ yesterday: 1, d7: 1, d30: 1 });
    expect(refunds.amount.yesterday).toEqual({ usd: 15 });

    const checkouts = summarizeCheckouts(
      [
        { id: 'cs_1', status: 'complete', created: sec('2026-10-17T05:00:00Z') },
        { id: 'cs_2', status: 'open', created: sec('2026-10-17T06:00:00Z') },
        { id: 'cs_3', status: 'expired', created: sec('2026-10-12T06:00:00Z') },
      ],
      windows
    );
    expect(checkouts.created).toEqual({ yesterday: 2, d7: 3, d30: 3 });
    expect(checkouts.completed).toEqual({ yesterday: 1, d7: 1, d30: 1 });
  });
});

describe('daily series + email', () => {
  it('buckets the last 7 days oldest-first', () => {
    const series = buildDailySeries(
      ['2026-10-17T10:00:00Z', '2026-10-17T11:00:00Z', '2026-10-11T00:00:00Z', '2026-10-10T23:59:59Z'],
      [sec('2026-10-15T00:00:00Z'), sec('2026-10-18T00:00:00Z')],
      windows
    );
    expect(series.map((p) => p.day)).toEqual([
      '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
    ]);
    expect(series.map((p) => p.signups)).toEqual([1, 0, 0, 0, 0, 0, 2]);
    expect(series.map((p) => p.paid)).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  it('formats the subject line', () => {
    const digest: any = {
      stripe: { mrr: { usd: 1234.5, cad: 0 }, subscriptions: { newSubscriptions: { yesterday: 2 } } },
      funnel: { signups: { yesterday: 7 } },
    };
    expect(digestSubject(digest)).toBe('Octree daily: MRR $1,234.5, +7 signups, +2 paid');
    digest.stripe.mrr.cad = 20;
    expect(digestSubject(digest)).toBe('Octree daily: MRR $1,234.5 (+CA$20), +7 signups, +2 paid');
  });

  it('formats money and sparklines', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(12.3, 'cad')).toBe('CA$12.3');
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
    expect(sparkline([0, 4, 8])).toBe('▁▅█');
  });

  it('renders the HTML digest with tables, no images', () => {
    const w = (yesterday: number, d7: number, d30: number) => ({ yesterday, d7, d30 });
    const digest: any = {
      generatedAt: '2026-10-18T13:00:00.000Z',
      windows: {
        yesterday: { label: 'Yesterday', start: '2026-10-17T00:00:00.000Z', end: '2026-10-18T00:00:00.000Z' },
        d7: { label: 'Last 7 days', start: '2026-10-11T00:00:00.000Z', end: '2026-10-18T00:00:00.000Z' },
        d30: { label: 'Last 30 days', start: '2026-09-18T00:00:00.000Z', end: '2026-10-18T00:00:00.000Z' },
      },
      stripe: {
        mrr: { usd: 129.87, cad: 10, byCurrency: { usd: 129.87, cad: 10 }, activeCount: 14, trialingCount: 0 },
        subscriptions: {
          newSubscriptions: w(1, 1, 5),
          cancellations: {
            yesterday: { count: 0, reasons: {} },
            d7: { count: 1, reasons: { unknown: 1 } },
            d30: { count: 5, reasons: { unknown: 2, cancellation_requested: 3 } },
          },
          pastDueCount: 8,
          unpaidCount: 0,
        },
        invoices: {
          gross: { yesterday: { usd: 9.99 }, d7: { usd: 29.97 }, d30: { usd: 134.86, cad: 10 } },
          paidInvoices: w(1, 3, 15),
          failedAttempts: w(5, 25, 93),
          recovered: w(1, 1, 2),
        },
        refunds: { count: w(0, 0, 0), amount: { yesterday: {}, d7: {}, d30: {} } },
        checkouts: { created: w(4, 15, 79), completed: w(1, 1, 7) },
      },
      funnel: {
        signups: w(7, 46, 239),
        onboardingCompleted: w(1, 1, 5),
        projectsCreated: w(5, 18, 91),
        draftsCreated: w(9, 62, 278),
        draftsConsumed: null,
        freeLimitUsersNow: 2,
        notes: ['<note>'],
      },
      daily: [
        { day: '2026-10-11', signups: 3, paid: 0 },
        { day: '2026-10-17', signups: 7, paid: 1 },
      ],
    };
    const html = renderDigestHtml(digest);
    expect(html).toContain('$129.87 + CA$10 (CAD, not converted)');
    expect(html).toContain('14 active, 0 trialing, 8 past due');
    expect(html).toContain('$134.86 + CA$10');
    expect(html).toContain('cancellation_requested ×3');
    expect(html).toContain('Drafts consumed');
    expect(html).toContain('n/a');
    expect(html).toContain('&lt;note&gt;');
    expect(html).not.toContain('<img');
    expect((html.match(/<table/g) ?? []).length).toBe(4);
  });
});
