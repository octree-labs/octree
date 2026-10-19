import { describe, it, expect, vi } from 'vitest';

import { sendLifecycleBatch, sendLifecycleEmail, unsubscribeHeaders, type LifecycleSendDeps } from '@/lib/lifecycle/send';
import { SCHEDULED_LIFECYCLE_TEMPLATES, renderLifecycleTemplate } from '@/lib/email/lifecycle';

function deps(overrides: Partial<LifecycleSendDeps> = {}) {
  const sent: Array<{ to: string; subject: string; headers: Record<string, string> }> = [];
  const claims: string[] = [];
  const marked: string[] = [];
  const failed: string[] = [];
  const capture = vi.fn();
  const d: LifecycleSendDeps = {
    mayEmail: async () => true,
    throttleMs: 0,
    mailer: {
      async send(input) {
        sent.push({ to: input.to, subject: input.subject, headers: input.headers });
        return { id: 'msg_1', error: null };
      },
    },
    ledger: {
      async claim({ userId, template }) {
        const key = `${userId}:${template}`;
        if (claims.includes(key)) return false;
        claims.push(key);
        return true;
      },
      async markSent({ userId, template, resendId }) {
        marked.push(`${userId}:${template}:${resendId}`);
      },
      async markFailed({ userId, template, error }) {
        failed.push(`${userId}:${template}:${error}`);
      },
    },
    capture,
    appUrl: 'https://app.example.com',
    toolsUrl: 'https://tools.example.com',
    unsubscribeUrl: (userId) => `https://app.example.com/api/email/unsubscribe?token=${userId}`,
    ...overrides,
  };
  return { d, sent, claims, marked, failed, capture };
}

const candidate = { userId: 'u1', email: 'a@example.com', template: 'welcome' as const, eligibleSince: 0 };

describe('sendLifecycleEmail', () => {
  it('claims the row, sends with one-click unsubscribe headers, stores the id and captures the event', async () => {
    const { d, sent, claims, marked, capture } = deps();
    const result = await sendLifecycleEmail(candidate, d);
    expect(result).toEqual({ userId: 'u1', template: 'welcome', sent: true, resendId: 'msg_1' });
    expect(claims).toEqual(['u1:welcome']);
    expect(marked).toEqual(['u1:welcome:msg_1']);
    expect(sent[0].to).toBe('a@example.com');
    expect(sent[0].subject).toBe('Start with a template');
    expect(sent[0].headers['List-Unsubscribe']).toBe('<https://app.example.com/api/email/unsubscribe?token=u1>');
    expect(sent[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(capture).toHaveBeenCalledWith('u1', 'welcome');
  });

  it('does not send when the row was already claimed', async () => {
    const { d, sent } = deps();
    await sendLifecycleEmail(candidate, d);
    const second = await sendLifecycleEmail(candidate, d);
    expect(second).toEqual({ userId: 'u1', template: 'welcome', sent: false, reason: 'already sent' });
    expect(sent).toHaveLength(1);
  });

  it('records a Resend error on the claimed row without marking it sent or capturing an event', async () => {
    const { d, capture, marked, failed } = deps({
      mailer: { async send() { return { id: null, error: 'boom' }; } },
    });
    const result = await sendLifecycleEmail(candidate, d);
    expect(result).toEqual({ userId: 'u1', template: 'welcome', sent: false, reason: 'boom' });
    expect(failed).toEqual(['u1:welcome:boom']);
    expect(marked).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('re-checks consent at send time and leaves no ledger row when it is gone', async () => {
    const { d, sent, claims } = deps({ mayEmail: async ({ email }) => email !== 'a@example.com' });
    const result = await sendLifecycleEmail(candidate, d);
    expect(result).toEqual({ userId: 'u1', template: 'welcome', sent: false, reason: 'opted out' });
    expect(sent).toHaveLength(0);
    expect(claims).toHaveLength(0);
  });

  it('paces the batch by throttleMs', async () => {
    vi.useFakeTimers();
    try {
      const { d, sent } = deps({ throttleMs: 500 });
      const run = sendLifecycleBatch(
        [candidate, { ...candidate, userId: 'u2', email: 'b@example.com' }],
        d
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      await run;
      expect(sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a throwing send does not stop the batch', async () => {
    const { d } = deps({
      mailer: {
        async send(input) {
          if (input.to === 'bad@example.com') throw new Error('network');
          return { id: 'ok', error: null };
        },
      },
    });
    const results = await sendLifecycleBatch(
      [
        { ...candidate, userId: 'u1', email: 'bad@example.com' },
        { ...candidate, userId: 'u2', email: 'good@example.com' },
      ],
      d
    );
    expect(results.map((r) => r.sent)).toEqual([false, true]);
  });
});

describe('lifecycle templates', () => {
  const input = {
    appUrl: 'https://app.example.com',
    toolsUrl: 'https://tools.example.com',
    unsubscribeUrl: 'https://app.example.com/api/email/unsubscribe?token=abc.def',
  };

  it.each(SCHEDULED_LIFECYCLE_TEMPLATES)('%s has a subject, one CTA and the unsubscribe link in both bodies', (template) => {
    const content = renderLifecycleTemplate(template, input);
    expect(content.subject.length).toBeGreaterThan(5);
    expect(content.html).toContain(input.unsubscribeUrl);
    expect(content.text).toContain(input.unsubscribeUrl);
    expect(content.html).not.toContain('<img');
    expect(content.html.match(/border-radius:8px/g)).toHaveLength(1);
  });

  it('welcome links the three templates and the editor', () => {
    const { html, text } = renderLifecycleTemplate('welcome', input);
    for (const slug of ['jakes-resume', 'neurips-2027', 'thesis']) {
      expect(html).toContain(`https://tools.example.com/templates/${slug}`);
      expect(text).toContain(`https://tools.example.com/templates/${slug}`);
    }
    expect(html).toContain('href="https://app.example.com/"');
  });

  it('limit_hit and winback deep-link to the paywall', () => {
    expect(renderLifecycleTemplate('limit_hit', input).html).toContain('https://app.example.com/?upgrade=1');
    expect(renderLifecycleTemplate('winback', input).html).toContain('https://app.example.com/?upgrade=1');
    expect(renderLifecycleTemplate('limit_hit', input).text).toContain('$9.99/month');
    expect(renderLifecycleTemplate('limit_hit', input).text).toContain('500 AI edits');
  });

  it('builds RFC 8058 headers', () => {
    expect(unsubscribeHeaders('https://x/y?token=1')).toEqual({
      'List-Unsubscribe': '<https://x/y?token=1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
