'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { fetchProjectExportUnlocked } from '@/lib/requests/export-unlock';
import { isExportUnlocked, ProjectActions, useProjectStore } from '@/stores/project';

/** `success_url` of an `export_single` checkout: /projects/<id>?export=unlocked. */
export const EXPORT_UNLOCKED_PARAM = 'export';
export const EXPORT_UNLOCKED_VALUE = 'unlocked';
/** About 10 reads over 20 s while the Stripe webhook catches up. */
export const EXPORT_UNLOCK_POLL_ATTEMPTS = 10;
export const EXPORT_UNLOCK_POLL_INTERVAL_MS = 2000;

export const EXPORT_UNLOCKED_TOAST = 'Export unlocked for this document';
export const EXPORT_UNLOCK_PENDING_TOAST =
  "Your payment went through, but export isn't unlocked yet. Refresh the page in a minute.";

/**
 * Back from Stripe with `?export=unlocked`: strips the param (without a
 * navigation), and confirms the unlock with a toast. When the store still
 * says locked (the webhook has not landed yet) it polls the user's own
 * project_export_unlocks row (RLS) up to EXPORT_UNLOCK_POLL_ATTEMPTS times,
 * EXPORT_UNLOCK_POLL_INTERVAL_MS apart, and updates the store as soon as it
 * shows up; if it never does, a toast asks for a refresh in a minute.
 *
 * Never starts a download: the user clicks Export themselves.
 *
 * The "came back from Stripe" flag lives in a ref, so React StrictMode's
 * mount / unmount / mount in development resumes the poll instead of
 * losing it with the already-stripped param.
 */
export function useExportUnlockReturn(projectId: string | null | undefined): void {
  const pendingRef = useRef<{ projectId: string } | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return;

    if (!checkedRef.current) {
      checkedRef.current = true;
      const url = new URL(window.location.href);
      if (url.searchParams.get(EXPORT_UNLOCKED_PARAM) === EXPORT_UNLOCKED_VALUE) {
        url.searchParams.delete(EXPORT_UNLOCKED_PARAM);
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        pendingRef.current = { projectId };
      }
    }

    const pending = pendingRef.current;
    if (!pending || pending.projectId !== projectId) return;

    if (isExportUnlocked(useProjectStore.getState(), projectId)) {
      pendingRef.current = null;
      toast.success(EXPORT_UNLOCKED_TOAST);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      const unlocked = await fetchProjectExportUnlocked(projectId);
      if (cancelled) return;
      if (unlocked || isExportUnlocked(useProjectStore.getState(), projectId)) {
        pendingRef.current = null;
        ProjectActions.setExportUnlocked(projectId, true);
        toast.success(EXPORT_UNLOCKED_TOAST);
        return;
      }
      if (attempts >= EXPORT_UNLOCK_POLL_ATTEMPTS) {
        pendingRef.current = null;
        toast.error(EXPORT_UNLOCK_PENDING_TOAST);
        return;
      }
      timer = setTimeout(poll, EXPORT_UNLOCK_POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, EXPORT_UNLOCK_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);
}
