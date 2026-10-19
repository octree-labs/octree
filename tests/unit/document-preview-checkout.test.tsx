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

describe('DocumentPreview checkout plan', () => {
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

  it('sends plan: monthly by default, like the paywall dialog', async () => {
    await openDocumentPreviewUpgradeDialog();

    fireEvent.click(screen.getByRole('button', { name: /subscribe now/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    const documentPreviewArgs = mockedCreateCheckoutSession.mock.calls[0][0];
    expect(documentPreviewArgs).toEqual({ plan: 'monthly', withTrial: false, source: 'generate-preview' });

    // Reference caller: PaywallDialog with its default (monthly) selection.
    // It is store-driven (stores/paywall.ts), so open it first.
    mockedCreateCheckoutSession.mockClear();
    PaywallActions.open('export');
    render(<PaywallDialog />);
    fireEvent.click(screen.getByRole('button', { name: /get octree pro/i }));
    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ ...documentPreviewArgs, source: 'paywall' });
  });

  it('sends plan: annual when Annual is picked', async () => {
    await openDocumentPreviewUpgradeDialog();

    fireEvent.click(screen.getByRole('radio', { name: /annual/i }));
    fireEvent.click(screen.getByRole('button', { name: /subscribe now/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ plan: 'annual', withTrial: false, source: 'generate-preview' });
  });

  it('sends plan: semester when the Semester pass is picked', async () => {
    await openDocumentPreviewUpgradeDialog();

    fireEvent.click(screen.getByRole('radio', { name: /semester pass/i }));
    fireEvent.click(screen.getByRole('button', { name: /subscribe now/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ plan: 'semester', withTrial: false, source: 'generate-preview' });
  });

  it('shows the real plan prices and never the retired weekly plan', async () => {
    await openDocumentPreviewUpgradeDialog();

    expect(screen.getByText('$9.99')).toBeInTheDocument();
    expect(screen.getByText(/per month/)).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /annual/i }));

    expect(screen.getByText('$79')).toBeInTheDocument();
    expect(screen.getByText(/per year/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$6\.58\/mo/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/4\.99/)).not.toBeInTheDocument();
    expect(screen.queryByText(/per week/)).not.toBeInTheDocument();
  });

  it('offers the 100-edit credit pack from the paywall and starts a credits checkout', async () => {
    PaywallActions.open('ai-edit');
    render(<PaywallDialog />);

    expect(screen.getByText(/buy 100 edits for \$5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /buy 100 ai edits for \$5/i }));

    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ plan: 'credits_100', source: 'paywall' });
  });

  it('leads the generate-quota paywall with the $2.99 one-off, Pro second, and sends the right plan for each', async () => {
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
    render(<PaywallDialog />);

    expect(screen.getByText(/used your free generation/i)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const single = buttons.findIndex((t) => /generate this one — \$2\.99/i.test(t));
    const pro = buttons.findIndex((t) => /go pro — \$9\.99\/mo/i.test(t));
    const notNow = buttons.findIndex((t) => /not now/i.test(t));
    expect(single).toBeGreaterThanOrEqual(0);
    expect(single).toBeLessThan(pro);
    expect(pro).toBeLessThan(notNow);
    expect(screen.getByText(/billed monthly at \$9\.99/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate this one/i }));
    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ plan: 'generate_single', source: 'paywall' });

    // While the one-off checkout is pending, only its button shows Loading and all three are disabled.
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /go pro/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not now/i })).toBeDisabled();
  });

  it('starts a monthly Pro checkout from the second card of the generate-quota paywall', async () => {
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
    render(<PaywallDialog />);

    fireEvent.click(screen.getByRole('button', { name: /go pro — \$9\.99\/mo/i }));
    await waitFor(() => expect(mockedCreateCheckoutSession).toHaveBeenCalledTimes(1));
    expect(mockedCreateCheckoutSession.mock.calls[0][0]).toEqual({ plan: 'monthly', withTrial: false, source: 'paywall' });
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate this one/i })).toBeDisabled();
  });

  it('shows only the credit pack to a Pro user who is out of monthly edits', async () => {
    PaywallActions.open('ai-edit', 'monthly_limit');
    render(<PaywallDialog />);

    expect(screen.getByText(/used this month's AI edits/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /get octree pro/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buy 100 ai edits for \$5/i })).toBeInTheDocument();
  });
});
