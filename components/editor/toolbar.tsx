'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { canUseFeature } from '@/lib/subscription/features';
import { PaywallActions } from '@/stores/paywall';
import { useExportUnlocked } from '@/stores/project';
import { AnalyticsEvents, type ExportFormat } from '@/lib/analytics/events';
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

/** Marks a menu item that needs Pro (or this project's export unlock). */
function ProTag() {
  return (
    <span className="ml-auto rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
      Pro
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
  const { usage, isLoading: isPlanLoading, refresh: refreshPlan } = useSubscriptionUsage();

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  // Export is Pro-only, unless this project has a one-off export unlock. The
  // menu items are disabled until the plan has loaded so a Pro user never
  // sees the paywall (an unlocked project needs no plan); if the plan could
  // not be loaded at all, say so instead of guessing.
  const exportUnlocked = useExportUnlocked(projectId);
  const exportAccess = canUseFeature(usage, 'export', { projectUnlocked: exportUnlocked });
  const showExportLock = !exportAccess.allowed && exportAccess.reason === 'paywall';
  const exportWaitsForPlan = isPlanLoading && !exportUnlocked;

  const gateExport = (format: ExportFormat, run: () => void) => {
    track(AnalyticsEvents.EXPORT_CLICKED, { format, allowed: exportAccess.allowed, unlocked: exportUnlocked });
    if (exportAccess.allowed) {
      run();
      return;
    }
    if (exportAccess.reason === 'unknown') {
      toast.error("Couldn't check your plan. Please try again.");
      void refreshPlan();
      return;
    }
    // With the project known, the paywall also sells "Export this document".
    if (projectId) {
      PaywallActions.open('export', 'pro_feature', ['single', 'pro'], { projectId });
    } else {
      PaywallActions.open('export');
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
                disabled={exporting || isSaving}
                className="gap-1"
                data-onboarding-target="editor-export"
              >
                Export
                {exporting ? (
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
                {showExportLock && <ProTag />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportZIP}
                disabled={exportWaitsForPlan}
                className="gap-2"
              >
                <FolderArchive className="size-4" />
                Export as ZIP
                {showExportLock && <ProTag />}
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
