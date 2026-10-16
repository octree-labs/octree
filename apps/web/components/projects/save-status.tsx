'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useSaveStatus } from '@/stores/save-status';

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatSavedAgo(date: Date, now: number): string {
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return 'Saved just now';
  if (minutes < 60) return `Saved ${minutes} min ago`;
  return `Saved at ${formatClock(date)}`;
}

export function SaveStatus() {
  const { isSaving, lastSaved } = useSaveStatus();
  const [now, setNow] = useState(() => Date.now());

  // Keep "N min ago" current.
  useEffect(() => {
    if (!lastSaved) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [lastSaved]);

  if (isSaving) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }

  // A freshly loaded document is already saved; lastSaved only appears after
  // a save in this session.
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-xs text-slate-500"
      title={lastSaved ? `Saved at ${formatClock(lastSaved)}` : 'All changes saved'}
    >
      <Check className="size-3" />
      {lastSaved ? formatSavedAgo(lastSaved, now) : 'Saved'}
    </span>
  );
}
