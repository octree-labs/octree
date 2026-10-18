'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  UsageIndicator,
} from '@/components/subscription/usage-indicator';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { canUseFeature } from '@/lib/subscription/features';
import { PaywallActions } from '@/stores/paywall';
import {
  Loader2,
  Download,
  FileText,
  FolderArchive,
  Lock,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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
}: EditorToolbarProps) {
  const [isMac, setIsMac] = useState(true);
  const { usage } = useSubscriptionUsage();

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  // Export is Pro-only. Until the plan has loaded this is "not allowed", so a
  // click opens the paywall rather than silently doing nothing.
  const canExport = canUseFeature(usage, 'export').allowed;

  const handleExportPDF = () => {
    if (!canExport) {
      PaywallActions.open('export');
    } else {
      onExportPDF();
    }
  };

  const handleExportZIP = () => {
    if (!canExport) {
      PaywallActions.open('export');
    } else {
      onExportZIP();
    }
  };
  return (
    <>
    <div
      className="flex-shrink-0 border-b border-slate-200 bg-white p-2"
      data-onboarding-target="toolbar"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">{children}</div>

        <div className="flex items-center gap-2">
          <UsageIndicator />
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
                disabled={!hasPdfData}
                className="gap-2"
              >
                <FileText className="size-4" />
                Export as PDF
                {!canExport && <Lock className="ml-auto size-3 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={handleExportZIP}
                className="gap-2"
              >
                <FolderArchive className="size-4" />
                Export as ZIP
                {!canExport && <Lock className="ml-auto size-3 text-amber-500" />}
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
