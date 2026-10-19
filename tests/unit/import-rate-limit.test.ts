import { describe, it, expect } from 'vitest';
import { clientIp, createRateLimiter } from '@/lib/import/rate-limit';

describe('createRateLimiter', () => {
  it('allows `limit` hits per window and then refuses with a Retry-After', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(limiter.check('ip', t0)).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 2 });
    expect(limiter.check('ip', t0 + 1000)).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 1 });
    expect(limiter.check('ip', t0 + 2000)).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 0 });

    const refused = limiter.check('ip', t0 + 3000);
    expect(refused.allowed).toBe(false);
    // The oldest hit (t0) leaves the window at t0 + 60s: 57s from now.
    expect(refused.retryAfterSeconds).toBe(57);
  });

  it('slides: hits fall out of the window individually', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000 });
    limiter.check('ip', 0);
    limiter.check('ip', 5000);
    expect(limiter.check('ip', 9000).allowed).toBe(false);
    // The hit at 0 has expired; the one at 5000 has not.
    expect(limiter.check('ip', 10_001).allowed).toBe(true);
    expect(limiter.check('ip', 10_002).allowed).toBe(false);
  });

  it('keeps keys independent and forgets idle ones', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
    expect(limiter.size()).toBe(2);
    expect(limiter.check('a', 5000).allowed).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  it('drops the least recently used key past maxKeys', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2 });
    limiter.check('a', 0);
    limiter.check('b', 1);
    limiter.check('c', 2);
    expect(limiter.size()).toBe(2);
    // 'a' was evicted, so it starts fresh.
    expect(limiter.check('a', 3).remaining).toBe(4);
  });
});

describe('clientIp', () => {
  it('takes the first x-forwarded-for hop, then x-real-ip, then a shared bucket', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
