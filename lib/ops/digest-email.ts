import type { ByCurrency, DailyDigest, WindowKey } from './digest';
import { WINDOW_KEYS } from './digest';

const CURRENCY_PREFIX: Record<string, string> = { usd: '$', cad: 'CA$', eur: '€', gbp: '£' };

export function formatMoney(amount: number, currency = 'usd'): string {
  const prefix = CURRENCY_PREFIX[currency.toLowerCase()] ?? `${currency.toUpperCase()} `;
  return `${prefix}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatByCurrency(money: ByCurrency): string {
  const parts = Object.entries(money)
    .filter(([, v]) => v !== 0)
    .map(([c, v]) => formatMoney(v, c));
  return parts.length ? parts.join(' + ') : '$0';
}

export function digestSubject(digest: DailyDigest): string {
  const { mrr } = digest.stripe;
  const mrrText = mrr.cad ? `${formatMoney(mrr.usd)} (+${formatMoney(mrr.cad, 'cad')})` : formatMoney(mrr.usd);
  const signups = digest.funnel.signups.yesterday;
  const paid = digest.stripe.subscriptions.newSubscriptions.yesterday;
  return `Octree daily: MRR ${mrrText}, +${signups} signups, +${paid} paid`;
}

function esc(value: string | number): string {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

type Row = { label: string; values: Record<WindowKey, string | number> };

function table(title: string, rows: Row[]): string {
  const head = `<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd">${esc(title)}</th>${WINDOW_KEYS.map(
    (k) =>
      `<th style="text-align:right;padding:4px 8px;border-bottom:1px solid #ddd">${esc(
        k === 'yesterday' ? 'Yesterday' : k === 'd7' ? '7d' : '30d'
      )}</th>`
  ).join('')}</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px">${esc(r.label)}</td>${WINDOW_KEYS.map(
          (k) => `<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums">${esc(r.values[k])}</td>`
        ).join('')}</tr>`
    )
    .join('');
  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:12px 0;min-width:360px">${head}${body}</table>`;
}

function reasons(digest: DailyDigest): string {
  const r = digest.stripe.subscriptions.cancellations.d30.reasons;
  const entries = Object.entries(r);
  if (!entries.length) return '';
  return `<p style="margin:4px 0 12px;color:#555">Cancellation reasons (30d): ${entries
    .map(([k, v]) => `${esc(k)} ×${v}`)
    .join(', ')}</p>`;
}

/** Text-only sparkline using block characters, one cell per day. */
export function sparkline(values: number[]): string {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values, 0);
  return values
    .map((v) => (max === 0 ? blocks[0] : blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))]))
    .join('');
}

function dailyRow(digest: DailyDigest): string {
  const head = `<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd">Last 7 days</th>${digest.daily
    .map((p) => `<th style="text-align:right;padding:4px 8px;border-bottom:1px solid #ddd;font-weight:normal;color:#777">${esc(p.day.slice(5))}</th>`)
    .join('')}<th style="padding:4px 8px;border-bottom:1px solid #ddd"></th></tr>`;
  const row = (label: string, values: number[]) =>
    `<tr><td style="padding:4px 8px">${esc(label)}</td>${values
      .map((v) => `<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums">${v}</td>`)
      .join('')}<td style="padding:4px 8px;font-family:monospace;letter-spacing:1px">${sparkline(values)}</td></tr>`;
  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:12px 0">${head}${row(
    'Sign-ups',
    digest.daily.map((p) => p.signups)
  )}${row('Paid conversions', digest.daily.map((p) => p.paid))}</table>`;
}

export function renderDigestHtml(digest: DailyDigest): string {
  const { stripe, funnel } = digest;
  const mrr = stripe.mrr;
  const money = (m: Record<WindowKey, ByCurrency>) =>
    ({ yesterday: formatByCurrency(m.yesterday), d7: formatByCurrency(m.d7), d30: formatByCurrency(m.d30) }) as Record<
      WindowKey,
      string
    >;

  const revenueRows: Row[] = [
    { label: 'Gross (paid invoices)', values: money(stripe.invoices.gross) },
    { label: 'Paid invoices', values: stripe.invoices.paidInvoices },
    { label: 'New subscriptions', values: stripe.subscriptions.newSubscriptions },
    {
      label: 'Cancellations',
      values: {
        yesterday: stripe.subscriptions.cancellations.yesterday.count,
        d7: stripe.subscriptions.cancellations.d7.count,
        d30: stripe.subscriptions.cancellations.d30.count,
      },
    },
    { label: 'Failed payment attempts', values: stripe.invoices.failedAttempts },
    { label: 'Recovered after failure', values: stripe.invoices.recovered },
    { label: 'Refunds', values: stripe.refunds.count },
    { label: 'Refunded amount', values: money(stripe.refunds.amount) },
    { label: 'Checkout sessions created', values: stripe.checkouts.created },
    { label: 'Checkout sessions completed', values: stripe.checkouts.completed },
  ];

  const funnelRows: Row[] = [
    { label: 'Sign-ups', values: funnel.signups },
    { label: 'Onboarding completed (cohort)', values: funnel.onboardingCompleted },
    { label: 'Projects created', values: funnel.projectsCreated },
    { label: 'Drafts created', values: funnel.draftsCreated },
    {
      label: 'Drafts consumed',
      values: funnel.draftsConsumed ?? { yesterday: 'n/a', d7: 'n/a', d30: 'n/a' },
    },
  ];

  const mrrOther = Object.entries(mrr.byCurrency)
    .filter(([c]) => c !== 'usd' && c !== 'cad')
    .map(([c, v]) => formatMoney(v, c));

  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;padding:16px">
<h2 style="margin:0 0 4px">Octree daily digest</h2>
<p style="margin:0 0 16px;color:#555">${esc(digest.windows.yesterday.start.slice(0, 10))} (UTC) · generated ${esc(digest.generatedAt)}</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 8px">
<tr><td style="padding:4px 8px"><strong>MRR</strong></td><td style="padding:4px 8px">${esc(formatMoney(mrr.usd))}${
    mrr.cad ? ` + ${esc(formatMoney(mrr.cad, 'cad'))} (CAD, not converted)` : ''
  }${mrrOther.length ? ` + ${esc(mrrOther.join(' + '))}` : ''}</td></tr>
<tr><td style="padding:4px 8px"><strong>Active subs</strong></td><td style="padding:4px 8px">${mrr.activeCount} active, ${mrr.trialingCount} trialing, ${stripe.subscriptions.pastDueCount} past due${
    stripe.subscriptions.unpaidCount ? `, ${stripe.subscriptions.unpaidCount} unpaid` : ''
  }</td></tr>
<tr><td style="padding:4px 8px"><strong>Free users at daily limit</strong></td><td style="padding:4px 8px">${funnel.freeLimitUsersNow}</td></tr>
</table>
${table('Revenue', revenueRows)}
${reasons(digest)}
${table('Funnel', funnelRows)}
${dailyRow(digest)}
${funnel.notes.length ? `<p style="margin-top:16px;color:#777;font-size:12px">${funnel.notes.map(esc).join('<br>')}</p>` : ''}
</body></html>`;
}
