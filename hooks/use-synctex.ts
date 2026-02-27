import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { toast } from 'sonner';
import {
  synctexForward,
  synctexReverse,
  type SynctexForwardResult,
} from '@/lib/utils/synctex';

interface UseSynctexOptions {
  projectId: string;
  currentFile: string | null;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  pdfData: string | null | undefined;
  onSwitchFile: (filePath: string) => void;
}

export function useSynctex({
  projectId,
  currentFile,
  editor,
  pdfData,
  onSwitchFile,
}: UseSynctexOptions) {
  const [forwardSyncResult, setForwardSyncResult] = useState<SynctexForwardResult[] | null>(null);
  const pendingRevealRef = useRef<{ line: number; column: number } | null>(null);

  // When editor instance changes, check for pending reveal (cross-file reverse sync)
  useEffect(() => {
    if (editor && pendingRevealRef.current) {
      const { line, column } = pendingRevealRef.current;
      pendingRevealRef.current = null;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    }
  }, [editor]);

  const handleForwardSync = useCallback(
    async (line: number, column: number) => {
      if (!pdfData || !currentFile) return;

      try {
        const results = await synctexForward(projectId, currentFile, line, column);
        if (results.length === 0) {
          toast.info('No matching PDF position found');
          return;
        }
        setForwardSyncResult(results);
      } catch {
        toast.error('SyncTeX forward lookup failed');
      }
    },
    [projectId, currentFile, pdfData]
  );

  const handleReverseSync = useCallback(
    async (page: number, h: number, v: number) => {
      if (!pdfData) return;

      try {
        const result = await synctexReverse(projectId, page, h, v);
        if (!result) {
          toast.info('No matching source position found');
          return;
        }

        // Always switch to the file returned by synctex
        onSwitchFile(result.file);

        // If it's a different file, the editor instance will change —
        // store a pending reveal that fires when the new editor mounts
        if (result.file !== currentFile) {
          pendingRevealRef.current = { line: result.line, column: result.column };
          return;
        }

        // Same file — reveal immediately
        if (editor) {
          editor.revealLineInCenter(result.line);
          editor.setPosition({ lineNumber: result.line, column: result.column });
          editor.focus();
        }
      } catch {
        toast.error('SyncTeX reverse lookup failed');
      }
    },
    [projectId, currentFile, pdfData, editor, onSwitchFile]
  );

  return {
    forwardSyncResult,
    handleForwardSync,
    handleReverseSync,
  };
}
