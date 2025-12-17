'use client';

import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UsageIndicator, UpgradeButton } from '@/components/subscription/usage-indicator';
import { Loader2, WandSparkles, ChevronDown, FileText, FolderArchive } from 'lucide-react';
import { useEffect, useState } from 'react';

interface EditorToolbarProps {
  onTextFormat: (format: 'bold' | 'italic' | 'underline') => void;
  onCompile: () => void;
  onExportPDF: () => void;
  onExportZIP: () => void;
  onOpenChat: () => void;
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
  compiling,
  exporting,
  isSaving,
  lastSaved,
  hasPdfData = false,
}: EditorToolbarProps) {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);
  return (
    <div className="flex-shrink-0 border-b border-slate-200 bg-white p-2">
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
          >
            <WandSparkles className="h-3.5 w-3.5" />
            <span className="font-medium">Edit with AI</span>
          </Button>
          <UpgradeButton />
        </div>

        <div className="flex items-center gap-2">
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
                onClick={onExportPDF}
                disabled={!hasPdfData}
                className="gap-2"
              >
                <FileText className="size-4" />
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onExportZIP}
                className="gap-2"
              >
                <FolderArchive className="size-4" />
                Export as ZIP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
