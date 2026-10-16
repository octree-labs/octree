'use client';

import { Code, WandSparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EditorPaneTab = 'code' | 'chat';

const TABS: { id: EditorPaneTab; label: string; icon: typeof Code }[] = [
  { id: 'chat', label: 'Edit with AI', icon: WandSparkles },
  { id: 'code', label: 'Code', icon: Code },
];

export function EditorPaneTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: EditorPaneTab;
  onTabChange: (tab: EditorPaneTab) => void;
}) {
  return (
    <div role="tablist" className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = activeTab === id;
        const isAi = id === 'chat';
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(id)}
            title={isAi ? `${label} (⌘B)` : label}
            data-onboarding-target={isAi ? 'editor-ai' : undefined}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
              isActive
                ? cn('bg-white shadow-sm', isAi ? 'text-primary' : 'text-slate-900')
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className={cn('size-3.5', isAi && 'text-primary')} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
