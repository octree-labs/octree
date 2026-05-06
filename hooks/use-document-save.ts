'use client';

import { useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { saveDocument } from '@/lib/requests/document';
import { useSelectedFile, useFileContent } from '@/stores/file';
import { useProject } from '@/stores/project';

export interface DocumentSaveState {
  isSaving: boolean;
  lastSaved: Date | null;
  handleSaveDocument: (contentToSave?: string) => Promise<boolean>;
  debouncedSave: (content: string) => void;
  setLastSaved: (date: Date | null) => void;
}

export function useDocumentSave(): DocumentSaveState {
  const project = useProject();
  const content = useFileContent();
  const selectedFile = useSelectedFile();

  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const handleSaveDocument = async (
    contentToSave?: string
  ): Promise<boolean> => {
    if (isSavingRef.current) return false;
    try {
      if (!project?.id || !selectedFile) {
        return false;
      }

      const contentToUse =
        contentToSave !== undefined ? contentToSave : content;

      if (!contentToUse) {
        return false;
      }

      isSavingRef.current = true;
      setIsSaving(true);

      const result = await saveDocument(
        project.id,
        selectedFile.id,
        contentToUse
      );

      if (!result.success) {
        console.error('Error saving document:', result.error);
        return false;
      }

      setLastSaved(new Date());
      return true;
    } catch (error) {
      console.error('Error saving document:', error);
      return false;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const debouncedSave = useDebouncedCallback((content: string) => {
    handleSaveDocument(content);
  }, 1000);

  return {
    isSaving,
    lastSaved,
    handleSaveDocument,
    debouncedSave,
    setLastSaved,
  };
}
