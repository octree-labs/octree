'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  UsageIndicator,
} from '@/components/subscription/usage-indicator';
import { FeatureList } from '@/app/onboarding/components/feature-list';
import { createCheckoutSession } from '@/lib/requests/subscription';
import {
  Loader2,
  Download,
  FileText,
  FolderArchive,
  Lock,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface SubscriptionData {
  hasSubscription: boolean;
  usage: {
    editCount: number;
    remainingEdits: number | null;
    isPro: boolean;
    hasUnlimitedEdits: boolean;
  };
}

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
  const [subscriptionData, setSubscriptionData] =
    useState<SubscriptionData | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [isMonthly, setIsMonthly] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);

    // Fetch subscription status
    fetch('/api/subscription-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSubscriptionData(data))
      .catch(() => {});
  }, []);

  const handleSubscribe = async () => {
    setIsCheckoutLoading(true);
    try {
      const checkoutUrl = await createCheckoutSession({
        annual: isMonthly,
        withTrial: false,
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      toast.error('Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

  // User must have subscription data loaded AND be pro to export
  const isPro = Boolean(
    subscriptionData?.hasSubscription ||
    subscriptionData?.usage?.isPro ||
    subscriptionData?.usage?.hasUnlimitedEdits
  );
  
  // If subscription data not loaded yet, assume not pro (safe default)
  const canExport = subscriptionData !== null && isPro;

  const handleExportPDF = () => {
    if (!canExport) {
      setShowUpgradeDialog(true);
    } else {
      onExportPDF();
    }
  };

  const handleExportZIP = () => {
    if (!canExport) {
      setShowUpgradeDialog(true);
    } else {
      onExportZIP();
    }
  };
  return (
    <>
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upgrade to Export</DialogTitle>
            <DialogDescription>
              Export features are available for Pro subscribers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Switch
                id="monthly-switch"
                checked={isMonthly}
                onCheckedChange={setIsMonthly}
              />
              <Label
                htmlFor="monthly-switch"
                className="cursor-pointer text-sm font-normal"
              >
                Save 50% with monthly billing
              </Label>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold">{isMonthly ? '$2.49' : '$4.99'}</p>
                <p className="text-sm text-muted-foreground">per week</p>
              </div>
              {isMonthly && (
                <p className="text-xs text-muted-foreground">Billed monthly at $9.99/month</p>
              )}
              {!isMonthly && (
                <p className="text-xs text-muted-foreground">Billed weekly</p>
              )}
            </div>

            <div>
              <p className="mb-4 text-sm font-semibold">Octree Pro includes</p>
              <FeatureList />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowUpgradeDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="gradient"
                onClick={handleSubscribe}
                disabled={isCheckoutLoading}
              >
                {isCheckoutLoading ? 'Loading...' : 'Subscribe Now'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
