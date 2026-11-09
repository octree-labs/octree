import { describe, it, expect } from 'vitest';
import { API_FREE_DAILY_COMPILES, API_PRO_DAILY_COMPILES } from '@/data/constants';
import {
  API_UPGRADE_URL,
  dailyLimitFor,
  decideQuota,
  quotaResetsAt,
  secondsUntilReset,
  usedToday,
  utcDay,
} from '@/lib/api/quota';

const NOW = new Date('2026-11-09T22:30:00.000Z');

describe('API quota', () => {
  it('has the contract limits', () => {
    expect(API_FREE_DAILY_COMPILES).toBe(30);
    expect(API_PRO_DAILY_COMPILES).toBe(1000);
    expect(dailyLimitFor('free')).toBe(30);
    expect(dailyLimitFor('pro')).toBe(1000);
  });

  it('uses UTC days and resets at the next UTC midnight', () => {
    expect(utcDay(NOW)).toBe('2026-11-09');
    expect(utcDay(new Date('2026-11-09T23:59:59.999-05:00'))).toBe('2026-11-10');
    expect(quotaResetsAt(NOW)).toBe('2026-11-10T00:00:00.000Z');
    expect(secondsUntilReset(NOW)).toBe(90 * 60);
  });

  it('allows up to and including the limit', () => {
    expect(decideQuota(1, 'free', NOW)).toEqual({ allowed: true, used: 1, limit: 30 });
    expect(decideQuota(30, 'free', NOW)).toEqual({ allowed: true, used: 30, limit: 30 });
    expect(decideQuota(31, 'pro', NOW)).toEqual({ allowed: true, used: 31, limit: 1000 });
  });

  it('refuses past the limit with the 429 body', () => {
    const decision = decideQuota(31, 'free', NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.body).toMatchObject({
      error: 'quota_exceeded',
      limit: 30,
      used: 30,
      resets_at: '2026-11-10T00:00:00.000Z',
      upgrade_url: 'https://app.useoctree.com/pricing?from=api',
    });
    expect(API_UPGRADE_URL).toBe('https://app.useoctree.com/pricing?from=api');
    expect(decideQuota(1001, 'pro', NOW).allowed).toBe(false);
  });

  it('reports used_today capped at the limit', () => {
    expect(usedToday(null, 'free')).toBe(0);
    expect(usedToday(12, 'free')).toBe(12);
    expect(usedToday(45, 'free')).toBe(30);
    expect(usedToday(45, 'pro')).toBe(45);
  });
});
