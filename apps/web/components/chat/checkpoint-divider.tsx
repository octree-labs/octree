'use client';

import { RotateCcw } from 'lucide-react';

interface CheckpointDividerProps {
  onRestore: () => void;
}

export function CheckpointDivider({ onRestore }: CheckpointDividerProps) {
  return (
    <div className="my-3 flex items-center gap-2">
      <div className="h-px flex-1 border-t border-dashed border-slate-200" />
      <button
        onClick={onRestore}
        className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <RotateCcw className="size-3" />
        Restore Checkpoint
      </button>
      <div className="h-px flex-1 border-t border-dashed border-slate-200" />
    </div>
  );
}
