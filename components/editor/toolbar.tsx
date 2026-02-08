'use client';

import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
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
  WandSparkles,
  ChevronDown,
  FileText,
  FolderArchive,
  HelpCircle,
  Lock,
  MessageSquare,
  PanelRightClose,
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
  onTextFormat: (format: 'bold' | 'italic' | 'underline') => void;
  onCompile: () => void;
  onExportPDF: () => void;
  onExportZIP: () => void;
  onOpenChat: () => void;
  onToggleChat: () => void;
  onStartWalkthrough?: () => void;
  chatOpen: boolean;
  compiling: boolean;
  exporting: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  hasPdfData?: boolean;
}

export function EditorToolbar({
  onTextFormat,
  onCompile,
  onExportPDF,
  onExportZIP,
  onOpenChat,
  onToggleChat,
  onStartWalkthrough,
  chatOpen,
  compiling,
  exporting,
  isSaving,
  lastSaved,
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ButtonGroup>
            <ButtonGroupItem
              onClick={() => onTextFormat('bold')}
              className="w-8 px-2.5 py-1"
            >
              <span className="font-bold">B</span>
            </ButtonGroupItem>
            <ButtonGroupItem
              onClick={() => onTextFormat('italic')}
              className="w-8 px-2.5 py-1"
            >
              <span className="italic">I</span>
            </ButtonGroupItem>
            <ButtonGroupItem
              onClick={() => onTextFormat('underline')}
              className="w-8 px-2.5 py-1"
            >
              <span className="underline">U</span>
            </ButtonGroupItem>
          </ButtonGroup>

          <Button
            variant="default"
            size="sm"
            onClick={onOpenChat}
            className="h-8 gap-1.5 border-slate-300 bg-gradient-to-b from-primary-light to-primary px-3 text-white hover:bg-gradient-to-b hover:from-primary-light/90 hover:to-primary/90"
            title="Edit with AI (⌘B)"
            data-onboarding-target="editor-ai"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            <span className="font-medium">Edit with AI</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {onStartWalkthrough && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onStartWalkthrough}
              className="gap-1"
              title="Show walkthrough"
            >
              <HelpCircle className="size-4" />
              <span className="hidden sm:inline">Tour</span>
            </Button>
          )}
          <UsageIndicator />
          {lastSaved && (
            <span className="text-sm text-slate-500">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onCompile}
            disabled={compiling}
            className="gap-1"
            data-onboarding-target="editor-compile"
          >
            {compiling ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Compiling
              </>
            ) : (
              <>
                Compile
                <span className="ml-1 pt-0.5 text-xs text-muted-foreground">
                  {isMac ? '⌘S' : 'Ctrl+S'}
                </span>
              </>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={exporting || isSaving}
                className="gap-1"
                data-onboarding-target="editor-export"
              >
                {exporting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Exporting
                  </>
                ) : (
                  <>
                    Export
                    <ChevronDown className="size-3.5" />
                  </>
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
            variant={chatOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleChat}
            className="gap-1.5"
            title={chatOpen ? 'Close AI Chat' : 'Open AI Chat'}
            data-onboarding-target="chat"
          >
            {chatOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            <span className="hidden sm:inline">
              {chatOpen ? 'Close' : 'Chat'}
            </span>
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}
