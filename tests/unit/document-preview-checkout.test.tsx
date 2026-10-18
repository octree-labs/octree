import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DocumentPreview } from '@/components/generate/DocumentPreview';
import { PaywallDialog } from '@/components/subscription/paywall-dialog';
import { PaywallActions } from '@/stores/paywall';
import { createCheckoutSession } from '@/lib/requests/subscription';

vi.mock('@/lib/requests/subscription', () => ({
  createCheckoutSession: vi.fn(),
}));

// No JSX inside vi.mock factories: they are hoisted above the React import.
vi.mock('@/components/editor/monaco-editor', () => ({
  MonacoEditor: () => null,
}));

vi.mock('@/components/pdf-viewer', () => ({
  default: () => null,
}));

vi.mock('@/lib/utils/compilation', () => ({
  makeCompilationRequest: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockedCreateCheckoutSession = vi.mocked(createCheckoutSession);

async function openDocumentPreviewUpgradeDialog() {
  render(
    <DocumentPreview
      latex="\\documentclass{article}"
      title="Test"
      onOpenInOctree={() => {}}
      isCreatingProject={false}
    />
  );

  // The dialog only opens once the (non-pro) subscription status has loaded.
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/subscription-status'));
  await waitFor(() => {
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(screen.getByRole('button', { name: /subscribe now/i })).toBeInTheDocument();
  });
}

describe('DocumentPreview checkout plan flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateCheckoutSession.mockImplementation(() => new Promise(() => {}));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hasSubscription: false,
        usage: { editCount: 0, remainingEdits: 5, isPro: false, hasUnlimitedEdits: false },
      }),
    }) as any;
  });

  it('sends annual: true (the $9.99/month price) when monthly is selected, like the paywall dialog', async () => {
    await openDocumentPreviewUpgradeDialog();

    fireEvent.click(screen.getByRole('button', { name: /subscribe now/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    const documentPreviewArgs = mockedCreateCheckoutSession.mock.calls[0][0];
    expect(documentPreviewArgs).toEqual({ annual: true, withTrial: false });

    // Reference caller: PaywallDialog with its default (monthly) selection.
    // It is store-driven (stores/paywall.ts), so open it first.
    mockedCreateCheckoutSession.mockClear();
    PaywallActions.open('export');
    render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: /get octree pro/i }));
    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual(documentPreviewArgs);
  });

  it('sends annual: false (the $4.99/week price) when monthly is toggled off', async () => {
    await openDocumentPreviewUpgradeDialog();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /subscribe now/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ annual: false, withTrial: false });
  });

  it('shows the real plan prices rather than a per-week fraction', async () => {
    await openDocumentPreviewUpgradeDialog();

    expect(screen.getByText('$9.99')).toBeInTheDocument();
    expect(screen.getByText(/per month/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.getByText(/per week/)).toBeInTheDocument();
  });
});
