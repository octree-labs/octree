import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

const mocks = vi.hoisted(() => ({
  fetchUnlocked: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/requests/export-unlock', () => ({
  fetchProjectExportUnlocked: mocks.fetchUnlocked,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import {
  EXPORT_UNLOCKED_TOAST,
  EXPORT_UNLOCK_PENDING_TOAST,
  EXPORT_UNLOCK_POLL_ATTEMPTS,
  EXPORT_UNLOCK_POLL_INTERVAL_MS,
  useExportUnlockReturn,
} from '@/hooks/use-export-unlock-return';
import { ExportUnlockSync } from '@/components/projects/export-unlock-sync';
import { isExportUnlocked, ProjectActions, useProjectStore } from '@/stores/project';

const PROJECT = '2f1c7d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function setUrl(path: string) {
  window.history.replaceState(null, '', path);
}

/** Advance one poll interval and let the awaited read settle. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXPORT_UNLOCK_POLL_INTERVAL_MS);
  });
}

describe('project store export unlock', () => {
  beforeEach(() => useProjectStore.setState({ project: null, exportUnlocked: false, exportUnlockProjectId: null }));

  it('applies only to the project it was loaded for', () => {
    ProjectActions.setExportUnlocked(PROJECT, true);
    const state = useProjectStore.getState();
    expect(isExportUnlocked(state, PROJECT)).toBe(true);
    expect(isExportUnlocked(state, OTHER)).toBe(false);
    expect(isExportUnlocked(state, undefined)).toBe(false);
  });

  it('switching projects never carries the previous unlock over', () => {
    setUrl(`/projects/${PROJECT}`);
    const { rerender } = render(<ExportUnlockSync projectId={PROJECT} exportUnlocked />);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(true);
    // Before the next project's value lands, the stale true does not apply to it.
    expect(isExportUnlocked(useProjectStore.getState(), OTHER)).toBe(false);
    rerender(<ExportUnlockSync projectId={OTHER} exportUnlocked={false} />);
    expect(isExportUnlocked(useProjectStore.getState(), OTHER)).toBe(false);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(false);
    cleanup();
  });

  it('ExportUnlockSync puts the server value into the store', () => {
    setUrl(`/projects/${PROJECT}`);
    render(<ExportUnlockSync projectId={PROJECT} exportUnlocked />);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(true);
    cleanup();
  });
});

describe('useExportUnlockReturn (?export=unlocked after Stripe)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useProjectStore.setState({ project: null, exportUnlocked: false, exportUnlockProjectId: null });
    mocks.fetchUnlocked.mockResolvedValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setUrl('/');
  });

  it('does nothing without the param', async () => {
    setUrl(`/projects/${PROJECT}?tab=chat`);
    renderHook(() => useExportUnlockReturn(PROJECT));
    await tick();
    expect(mocks.fetchUnlocked).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=chat');
  });

  it('strips the param, keeps the rest of the URL, and toasts at once when already unlocked', () => {
    ProjectActions.setExportUnlocked(PROJECT, true);
    setUrl(`/projects/${PROJECT}?export=unlocked&tab=chat#pdf`);

    renderHook(() => useExportUnlockReturn(PROJECT));

    expect(window.location.pathname).toBe(`/projects/${PROJECT}`);
    expect(window.location.search).toBe('?tab=chat');
    expect(window.location.hash).toBe('#pdf');
    expect(mocks.toastSuccess).toHaveBeenCalledWith(EXPORT_UNLOCKED_TOAST);
    expect(mocks.fetchUnlocked).not.toHaveBeenCalled();
  });

  it('polls while the webhook lags and unlocks the store when the row appears', async () => {
    setUrl(`/projects/${PROJECT}?export=unlocked`);
    mocks.fetchUnlocked.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderHook(() => useExportUnlockReturn(PROJECT));
    expect(window.location.search).toBe('');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    await tick();
    await tick();
    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(2);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(false);

    await tick();
    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(3);
    expect(mocks.fetchUnlocked).toHaveBeenCalledWith(PROJECT);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(true);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(EXPORT_UNLOCKED_TOAST);

    // Done: no more reads.
    await tick();
    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(3);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('gives up after 10 reads over 20 s and asks for a refresh', async () => {
    setUrl(`/projects/${PROJECT}?export=unlocked`);

    renderHook(() => useExportUnlockReturn(PROJECT));
    for (let i = 0; i < EXPORT_UNLOCK_POLL_ATTEMPTS + 3; i += 1) await tick();

    expect(EXPORT_UNLOCK_POLL_ATTEMPTS * EXPORT_UNLOCK_POLL_INTERVAL_MS).toBe(20_000);
    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(EXPORT_UNLOCK_POLL_ATTEMPTS);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(EXPORT_UNLOCK_PENDING_TOAST);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(false);
  });

  it('stops polling on unmount', async () => {
    setUrl(`/projects/${PROJECT}?export=unlocked`);
    const { unmount } = renderHook(() => useExportUnlockReturn(PROJECT));
    await tick();
    unmount();
    await tick();
    await tick();
    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('keeps polling under StrictMode (double effect) after the param is gone', async () => {
    setUrl(`/projects/${PROJECT}?export=unlocked`);
    mocks.fetchUnlocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderHook(() => useExportUnlockReturn(PROJECT), { wrapper: StrictMode });
    await tick();
    await tick();

    expect(mocks.fetchUnlocked).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(isExportUnlocked(useProjectStore.getState(), PROJECT)).toBe(true);
  });

  it('ExportUnlockSync with the server saying unlocked toasts without polling', () => {
    setUrl(`/projects/${PROJECT}?export=unlocked`);
    render(<ExportUnlockSync projectId={PROJECT} exportUnlocked />);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(EXPORT_UNLOCKED_TOAST);
    expect(mocks.fetchUnlocked).not.toHaveBeenCalled();
  });
});
