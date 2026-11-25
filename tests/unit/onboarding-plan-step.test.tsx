import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PlanStepActions } from '@/app/onboarding/components/plan-step-actions';
import { track } from '@/lib/analytics/track';

vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
}));

function renderStep(paywallRequired: boolean) {
  const handlers = {
    onCheckout: vi.fn(),
    onContinueFree: vi.fn(),
    onSignOut: vi.fn(),
  };
  const view = render(
    <PlanStepActions paywallRequired={paywallRequired} isSubmitting={false} {...handlers} />
  );
  return { ...handlers, ...view };
}

afterEach(() => {
  cleanup();
  vi.mocked(track).mockClear();
});

describe('onboarding plan step, paywall on', () => {
  it('offers no free path, only checkout and a way out of the account', () => {
    const { onCheckout, onSignOut, onContinueFree } = renderStep(true);

    expect(screen.queryByText(/continue with the free plan/i)).toBeNull();
    expect(screen.queryByText(/free includes/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /get octree pro/i }));
    expect(onCheckout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /use a different account/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onContinueFree).not.toHaveBeenCalled();
  });

  it('reports paywall_shown with placement onboarding once', () => {
    const { rerender, onCheckout, onContinueFree, onSignOut } = renderStep(true);
    rerender(
      <PlanStepActions
        paywallRequired
        isSubmitting
        onCheckout={onCheckout}
        onContinueFree={onContinueFree}
        onSignOut={onSignOut}
      />
    );

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('paywall_shown', {
      feature: 'onboarding',
      reason: 'onboarding_required',
      offers: ['pro'],
      placement: 'onboarding',
    });
  });
});

describe('onboarding plan step, paywall off', () => {
  it('keeps "Continue with the free plan" and reports no paywall', () => {
    const { onContinueFree } = renderStep(false);

    fireEvent.click(screen.getByRole('button', { name: /continue with the free plan/i }));
    expect(onContinueFree).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /get octree pro/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /use a different account/i })).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
