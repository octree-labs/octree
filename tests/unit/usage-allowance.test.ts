import { describe, it, expect } from 'vitest';

import { decideAllowance, limitReachedMessage, remainingAllowance } from '@/lib/usage/allowance';
import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

const NOW = new Date('2026-10-18T12:00:00');

describe('decideAllowance', () => {
  describe('free tier', () => {
    it('spends the daily allowance first even when credits are available', () => {
      expect(
        decideAllowance({ edit_count: 0, monthly_edit_count: 0, edit_credits: 100 }, false, NOW)
      ).toBe('free');
      expect(
        decideAllowance(
          { edit_count: FREE_DAILY_EDIT_LIMIT - 1, monthly_edit_count: 0, edit_credits: 100 },
          false,
          NOW
        )
      ).toBe('free');
    });

    it('spends a credit once the daily allowance is gone', () => {
      expect(
        decideAllowance(
          { edit_count: FREE_DAILY_EDIT_LIMIT, monthly_edit_count: 0, edit_credits: 1 },
          false,
          NOW
        )
      ).toBe('credit');
    });

    it('blocks when both the daily allowance and the credits are gone', () => {
      expect(
        decideAllowance(
          { edit_count: FREE_DAILY_EDIT_LIMIT, monthly_edit_count: 0, edit_credits: 0 },
          false,
          NOW
        )
      ).toBe('blocked');
      expect(
        decideAllowance({ edit_count: FREE_DAILY_EDIT_LIMIT, monthly_edit_count: 0 }, false, NOW)
      ).toBe('blocked');
    });

    it('treats a daily reset date in the past as a fresh allowance', () => {
      expect(
        decideAllowance(
          {
            edit_count: FREE_DAILY_EDIT_LIMIT,
            monthly_edit_count: 0,
            edit_credits: 0,
            daily_reset_date: '2026-10-17',
          },
          false,
          NOW
        )
      ).toBe('free');
    });

    it('does not reset on the same day', () => {
      expect(
        decideAllowance(
          {
            edit_count: FREE_DAILY_EDIT_LIMIT,
            monthly_edit_count: 0,
            edit_credits: 0,
            daily_reset_date: '2026-10-18',
          },
          false,
          NOW
        )
      ).toBe('blocked');
    });
  });

  describe('pro tier', () => {
    it('spends the monthly allowance first, ignoring the daily counter', () => {
      expect(
        decideAllowance(
          { edit_count: 999, monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT - 1, edit_credits: 5 },
          true,
          NOW
        )
      ).toBe('pro');
    });

    it('spends a credit once the monthly allowance is gone', () => {
      expect(
        decideAllowance(
          { edit_count: 0, monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT, edit_credits: 3 },
          true,
          NOW
        )
      ).toBe('credit');
    });

    it('blocks when the monthly allowance and the credits are gone', () => {
      expect(
        decideAllowance(
          { edit_count: 0, monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT, edit_credits: 0 },
          true,
          NOW
        )
      ).toBe('blocked');
    });

    it('treats a monthly reset date that has passed as a fresh allowance', () => {
      expect(
        decideAllowance(
          {
            edit_count: 0,
            monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT,
            edit_credits: 0,
            monthly_reset_date: '2026-10-01',
          },
          true,
          NOW
        )
      ).toBe('pro');
    });

    it('does not reset before the monthly reset date', () => {
      expect(
        decideAllowance(
          {
            edit_count: 0,
            monthly_edit_count: PRO_MONTHLY_EDIT_LIMIT,
            edit_credits: 0,
            monthly_reset_date: '2026-11-01',
          },
          true,
          NOW
        )
      ).toBe('blocked');
    });
  });

  it('tolerates null counters', () => {
    expect(decideAllowance({ edit_count: null, monthly_edit_count: null, edit_credits: null }, false, NOW)).toBe(
      'free'
    );
  });
});

describe('remainingAllowance', () => {
  it('counts down the plan allowance without the credits', () => {
    expect(remainingAllowance({ edit_count: 2, monthly_edit_count: 0, edit_credits: 100 }, false, NOW)).toBe(
      FREE_DAILY_EDIT_LIMIT - 2
    );
    expect(remainingAllowance({ edit_count: 0, monthly_edit_count: 10, edit_credits: 100 }, true, NOW)).toBe(
      PRO_MONTHLY_EDIT_LIMIT - 10
    );
  });

  it('never goes negative', () => {
    expect(remainingAllowance({ edit_count: 50, monthly_edit_count: 0 }, false, NOW)).toBe(0);
  });
});

describe('limitReachedMessage', () => {
  it('offers the credit pack to free and Pro users alike', () => {
    expect(limitReachedMessage(false)).toContain('buy 100 edits for $5');
    expect(limitReachedMessage(false)).toContain('Upgrade to Pro');
    expect(limitReachedMessage(true)).toContain('buy 100 edits for $5');
    expect(limitReachedMessage(true)).not.toContain('Upgrade');
  });
});
