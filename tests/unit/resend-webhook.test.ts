import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

/**
 * lib/email/resend-webhook.ts (the Svix-style signature check and payload
 * parsing) and app/api/webhooks/resend/route.ts (fails closed without a
 * secret, refuses bad signatures, turns opens/clicks on ledgered emails
 * into PostHog events for the recipient).
 */

const mocks = vi.hoisted(() => {
  const captureServerEventAfterResponse = vi.fn();
  const captureServerExceptionAfterResponse = vi.fn();
  const limit = vi.fn();
  const from = vi.fn((table: string) => {
    if (table !== 'lifecycle_emails') throw new Error(`unexpected table ${table}`);
    return { select: () => ({ eq: () => ({ limit }) }) };
  });
  return { captureServerEventAfterResponse, captureServerExceptionAfterResponse, limit, from };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEventAfterResponse: mocks.captureServerEventAfterResponse,
  captureServerExceptionAfterResponse: mocks.captureServerExceptionAfterResponse,
}));

import {
  SVIX_TOLERANCE_SECONDS,
  linkForAnalytics,
  parseResendWebhook,
  verifySvixSignature,
} from '@/lib/email/resend-webhook';
import { POST } from '@/app/api/webhooks/resend/route';

const KEY = Buffer.from('a-32-byte-signing-key-for-tests!');
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = 1_760_000_000;

function sign(id: string, timestamp: number | string, body: string, key: Buffer = KEY): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

describe('verifySvixSignature', () => {
  const body = '{"type":"email.clicked"}';

  it('accepts a signature made with the secret over id.timestamp.body', () => {
    expect(
      verifySvixSignature({ secret: SECRET, id: 'msg_1', timestamp: String(NOW), signature: sign('msg_1', NOW, body), body, nowSeconds: NOW })
    ).toBe(true);
  });

  it('accepts when any one of several space-separated signatures matches', () => {
    const signature = `v1,${Buffer.alloc(32, 1).toString('base64')} ${sign('msg_1', NOW, body)}`;
    expect(verifySvixSignature({ secret: SECRET, id: 'msg_1', timestamp: String(NOW), signature, body, nowSeconds: NOW })).toBe(true);
  });

  it('rejects a tampered body, a different id and a wrong secret', () => {
    const good = sign('msg_1', NOW, body);
    const base = { secret: SECRET, id: 'msg_1', timestamp: String(NOW), signature: good, nowSeconds: NOW };
    expect(verifySvixSignature({ ...base, body: body + ' ' })).toBe(false);
    expect(verifySvixSignature({ ...base, id: 'msg_2', body })).toBe(false);
    expect(verifySvixSignature({ ...base, body, secret: `whsec_${Buffer.alloc(32, 7).toString('base64')}` })).toBe(false);
    expect(verifySvixSignature({ ...base, body, signature: sign('msg_1', NOW, body, Buffer.alloc(32, 7)) })).toBe(false);
  });

  it('rejects timestamps outside the 5-minute tolerance, either way', () => {
    const stale = NOW - SVIX_TOLERANCE_SECONDS - 1;
    const future = NOW + SVIX_TOLERANCE_SECONDS + 1;
    const edge = NOW - SVIX_TOLERANCE_SECONDS;
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(stale), signature: sign('m', stale, body), body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(future), signature: sign('m', future, body), body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(edge), signature: sign('m', edge, body), body, nowSeconds: NOW })).toBe(true);
  });

  it('rejects missing or malformed headers, unknown versions and an empty secret', () => {
    const good = sign('m', NOW, body);
    expect(verifySvixSignature({ secret: SECRET, id: null, timestamp: String(NOW), signature: good, body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: null, signature: good, body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature: null, body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: 'yesterday', signature: good, body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature: good.replace('v1,', 'v0,'), body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature: 'v1', body, nowSeconds: NOW })).toBe(false);
    expect(verifySvixSignature({ secret: 'whsec_', id: 'm', timestamp: String(NOW), signature: good, body, nowSeconds: NOW })).toBe(false);
  });
});

describe('verifySvixSignature robustness', () => {
  const body = '{"type":"email.opened"}';

  it('never throws on junk in the signature header, and still finds the good entry among it', () => {
    const good = sign('m', NOW, body);
    const junk = ['v1,!!!not-base64!!!', 'v1a,AAAA', 'v1', 'v1,', ',', '', 'v1,QQ=='];
    for (const entry of junk) {
      expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature: entry, body, nowSeconds: NOW })).toBe(false);
    }
    const header = `${junk.join(' ')}  ${good}   ${junk[0]}`;
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature: header, body, nowSeconds: NOW })).toBe(true);
  });

  it('signs the exact raw bytes: a re-serialised body with the same JSON is a different message', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    const signature = sign('m', NOW, body);
    expect(verifySvixSignature({ secret: SECRET, id: 'm', timestamp: String(NOW), signature, body: pretty, nowSeconds: NOW })).toBe(false);
  });

  it('accepts a secret without the whsec_ prefix the same way the Svix SDK does', () => {
    const signature = sign('m', NOW, body);
    expect(verifySvixSignature({ secret: KEY.toString('base64'), id: 'm', timestamp: String(NOW), signature, body, nowSeconds: NOW })).toBe(true);
  });
});

describe('parseResendWebhook', () => {
  it('reads opens and clicks with the message id and the link', () => {
    expect(parseResendWebhook(JSON.stringify({ type: 'email.opened', data: { email_id: 'em_1' } }))).toEqual({
      kind: 'engagement',
      event: { type: 'email.opened', emailId: 'em_1', link: null },
    });
    expect(
      parseResendWebhook(
        JSON.stringify({ type: 'email.clicked', data: { email_id: 'em_2', click: { link: 'https://app.useoctree.com/?upgrade=1' } } })
      )
    ).toEqual({ kind: 'engagement', event: { type: 'email.clicked', emailId: 'em_2', link: 'https://app.useoctree.com/?upgrade=1' } });
  });

  it('ignores other Resend events and refuses junk', () => {
    expect(parseResendWebhook(JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } }))).toEqual({ kind: 'ignored', type: 'email.delivered' });
    expect(parseResendWebhook('not json')).toEqual({ kind: 'invalid' });
    expect(parseResendWebhook('[]')).toEqual({ kind: 'invalid' });
    expect(parseResendWebhook(JSON.stringify({ type: 'email.clicked', data: {} }))).toEqual({ kind: 'invalid' });
  });

  it('reduces a clicked link to hostname and path for analytics', () => {
    expect(linkForAnalytics('https://app.useoctree.com/settings?utm_campaign=x&token=secret#tab')).toBe('app.useoctree.com/settings');
    expect(linkForAnalytics('https://tools.useoctree.com/templates/thesis')).toBe('tools.useoctree.com/templates/thesis');
    expect(linkForAnalytics(null)).toBeUndefined();
    expect(linkForAnalytics('nope')).toBeUndefined();
  });
});

describe('POST /api/webhooks/resend', () => {
  function request(payload: unknown, options: { secretKey?: Buffer; timestamp?: number; id?: string } = {}) {
    const body = JSON.stringify(payload);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const id = options.id ?? 'msg_1';
    return new Request('https://app.example.com/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': String(timestamp),
        'svix-signature': sign(id, timestamp, body, options.secretKey),
      },
      body,
    });
  }

  const clicked = { type: 'email.clicked', data: { email_id: 'em_1', click: { link: 'https://app.useoctree.com/?upgrade=1&utm_campaign=limit_hit' } } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    mocks.limit.mockResolvedValue({ data: [{ user_id: 'user-1', template: 'limit_hit' }], error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed with 503 when the secret is not configured', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
    const response = await POST(request(clicked));
    expect(response.status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('refuses a bad signature and a stale timestamp with 400 and touches nothing', async () => {
    expect((await POST(request(clicked, { secretKey: Buffer.alloc(32, 9) }))).status).toBe(400);
    expect((await POST(request(clicked, { timestamp: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(400);
    const unsigned = new Request('https://app.example.com/api/webhooks/resend', { method: 'POST', body: JSON.stringify(clicked) });
    expect((await POST(unsigned)).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('captures email_clicked for the ledgered recipient with hostname + path only', async () => {
    const response = await POST(request(clicked));
    expect(response.status).toBe(200);
    expect(mocks.captureServerEventAfterResponse).toHaveBeenCalledWith('user-1', 'email_clicked', {
      template: 'limit_hit',
      link: 'app.useoctree.com/',
    });
  });

  it('captures email_opened without a link', async () => {
    mocks.limit.mockResolvedValue({ data: [{ user_id: 'user-2', template: 'pro_inactive' }], error: null });
    const response = await POST(request({ type: 'email.opened', data: { email_id: 'em_9' } }));
    expect(response.status).toBe(200);
    expect(mocks.captureServerEventAfterResponse).toHaveBeenCalledWith('user-2', 'email_opened', { template: 'pro_inactive' });
  });

  it('answers 200 and records nothing for an email that is not in the ledger', async () => {
    mocks.limit.mockResolvedValue({ data: [], error: null });
    const response = await POST(request(clicked));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, unknown_email: true });
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });

  it('answers 200 for events it does not act on, without a lookup', async () => {
    const response = await POST(request({ type: 'email.bounced', data: { email_id: 'em_1' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: 'email.bounced' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('answers 400 for a signed body that is not a Resend event', async () => {
    expect((await POST(request({ hello: 'world' }))).status).toBe(400);
  });

  it('answers 500 (so Resend retries) when the ledger read fails', async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const response = await POST(request(clicked));
    expect(response.status).toBe(500);
    expect(mocks.captureServerExceptionAfterResponse).toHaveBeenCalled();
    expect(mocks.captureServerEventAfterResponse).not.toHaveBeenCalled();
  });
});
