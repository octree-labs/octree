'use client';

import { OctreeLogo } from '@/components/icons/octree-logo';

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <OctreeLogo className="size-10" />
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-800">
          How can I help?
        </h3>
        <p className="max-w-xs text-sm text-slate-500">
          Ask for edits, fixes, or anything about your document.
        </p>
      </div>
    </div>
  );
}
