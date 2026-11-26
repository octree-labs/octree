'use client';

import { useEffect, useState } from 'react';

import { formatPassEnd } from '@/lib/subscription/pass-format';

/**
 * A Deadline Pass end formatted like Settings, in the viewer's own time
 * zone (formatted after mount; the server render shows the ISO date).
 */
export function PassEndDate({ iso }: { iso: string }) {
  const [text, setText] = useState(iso.slice(0, 10));
  useEffect(() => {
    const date = new Date(iso);
    if (Number.isFinite(date.getTime())) setText(formatPassEnd(date));
  }, [iso]);
  return <>{text}</>;
}
