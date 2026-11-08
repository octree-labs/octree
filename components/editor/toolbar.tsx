'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { decideExport } from '@/lib/subscription/features';
import { PaywallActions } from '@/stores/paywall';
import { ProjectActions, useExportUnlocked } from '@/stores/project';
import { AnalyticsEvents, type ExportFormat, type PaywallReason } from '@/lib/analytics/events';
import { claimFreeFirstExport } from '@/actions/claim-free-export';
import { track } from '@/lib/analytics/track';
import {
  Loader2,
  Download,
  FileText,
  FolderArchive,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface EditorToolbarProps {
  /** Left side of the toolbar (pane tabs, formatting). */
  children?: React.ReactNode;
  onCompile: () => void;
  onExportPDF: () => void;
  onExportZIP: () => void;
  compiling: boolean;
  exporting: boolean;
  isSaving: boolean;
  hasPdfData?: boolean;
  /**
   * The open project. Its one-off export unlock (stores/project.ts) allows
   * export without Pro, and the export paywall offers that unlock for it.
   */
  projectId?: string;
}

/** Shown once, when the free first export is granted. */
export const FREE_EXPORT_TOAST = 'Your first export is on us. Pro unlocks unlimited exports.';

/** Marks a menu item that needs Pro (or this project's export unlock), or is free once. */
function ExportTag({ label }: { label: 'Pro' | 'Free' }) {
  return (
    <span className="ml-auto rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
      {label}
    </span>
  );
}

export function EditorToolbar({
  children,
  onCompile,
  onExportPDF,
  onExportZIP,
  compiling,
  exporting,
  isSaving,
  hasPdfData = false,
  projectId,
}: EditorToolbarProps) {
  const [isMac, setIsMac] = useState(true);
  const [claimingFreeExport, setClaimingFreeExport] = useState(false);
  const { usage, isLoading: isPlanLoading, refresh: refreshPlan } = useSubscriptionUsage();

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  // Export is Pro-only, unless this project has a one-off export unlock or
  // the account's free first export is unused (lib/subscription/features.ts
  // `decideExport`). The menu items are disabled until the plan has loaded
  // so a Pro user never sees the paywall (an unlocked project needs no
  // plan); if the plan could not be loaded at all, say so instead of guessing.
  const exportUnlocked = useExportUnlocked(projectId);
  const exportDecision = decideExport(usage, { projectUnlocked: exportUnlocked });
  const exportTag =
    exportDecision.action === 'paywall' ? 'Pro' : exportDecision.action === 'claim-free' ? 'Free' : null;
  const exportWaitsForPlan = (isPlanLoading && !exportUnlocked) || claimingFreeExport;

  const openExportPaywall = (reason: PaywallReason) => {
    // With the project known, the paywall also sells "Export this document".
    if (projectId) {
      PaywallActions.open('export', reason, ['single', 'pro'], { projectId });
    } else {
      PaywallActions.open('export', reason);
    }
  };

  // The server decides whether the free export applies; the browser only
  // asks. Granted: the project is unlocked for good and the export runs.
  const claimFreeExport = async (format: ExportFormat, run: () => void) => {
    if (!projectId) {
      openExportPaywall('pro_feature');
      return;
    }
    setClaimingFreeExport(true);
    try {
      const { status } = await claimFreeFirstExport(projectId, format);
      if (status === 'granted' || status === 'unlocked') {
        ProjectActions.setExportUnlocked(projectId, true);
        run();
        if (status === 'granted') toast.success(FREE_EXPORT_TOAST);
        // Other projects now see the free export as used.
        window.dispatchEvent(new Event('usage-update'));
        return;
      }
      if (status === 'used') {
        window.dispatchEvent(new Event('usage-update'));
        openExportPaywall('free_export_used');
        return;
      }
      openExportPaywall('pro_feature');
    } catch (error) {
      console.error('Free export claim failed:', error);
      openExportPaywall('pro_feature');
    } finally {
      setClaimingFreeExport(false);
    }
  };

  const gateExport = (format: ExportFormat, run: () => void) => {
    track(AnalyticsEvents.EXPORT_CLICKED, {
      format,
      allowed: exportDecision.action === 'export',
      unlocked: exportUnlocked,
      ...(exportDecision.action === 'claim-free' ? { free_first: true } : {}),
    });
    switch (exportDecision.action) {
      case 'export':
        run();
        return;
      case 'claim-free':
        void claimFreeExport(format, run);
        return;
      case 'unknown':
        toast.error("Couldn't check your plan. Please try again.");
        void refreshPlan();
        return;
      case 'paywall':
        openExportPaywall(exportDecision.reason);
        return;
    }
  };

  const handleExportPDF = () => gateExport('pdf', onExportPDF);
  const handleExportZIP = () => gateExport('zip', onExportZIP);
  return (
    <>
    <div
      className="flex-shrink-0 border-b border-slate-200 bg-white p-2"
      data-onboarding-target="toolbar"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">{children}</div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={exporting || isSaving || claimingFreeExport}
                className="gap-1"
                data-onboarding-target="editor-export"
              >
                Export
                {exporting || claimingFreeExport ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleExportPDF}
                disabled={!hasPdfData || exportWaitsForPlan}
                className="gap-2"
              >
                <FileText className="size-4" />
                Export as PDF
                {exportTag && <ExportTag label={exportTag} />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportZIP}
                disabled={exportWaitsForPlan}
                className="gap-2"
              >
                <FolderArchive className="size-4" />
                Export as ZIP
                {exportTag && <ExportTag label={exportTag} />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="default"
            size="sm"
            onClick={onCompile}
            disabled={compiling}
            className="gap-1.5"
            title={compiling ? 'Compiling…' : 'Compile'}
            data-onboarding-target="editor-compile"
          >
            {compiling && <Loader2 className="size-3.5 animate-spin" />}
            Compile
            <kbd className="ml-0.5 rounded border border-white/25 bg-white/15 px-1 font-sans text-[10px] font-medium leading-4 text-white/85">
              {isMac ? '⌘S' : 'Ctrl+S'}
            </kbd>
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}
