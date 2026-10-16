'use client';

import { useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { saveDocument } from '@/lib/requests/document';
import { useSelectedFile, useFileContent } from '@/stores/file';
import { useProject } from '@/stores/project';
import { SaveStatusActions, useSaveStatus } from '@/stores/save-status';

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

  // Lives in a store so the project header can show it too.
  const { isSaving, lastSaved } = useSaveStatus();
  const { setIsSaving, setLastSaved } = SaveStatusActions;
  useEffect(() => SaveStatusActions.reset, []);

  const handleSaveDocument = async (
    contentToSave?: string
  ): Promise<boolean> => {
    try {
      if (!project?.id || !selectedFile) {
        return false;
      }

      const contentToUse =
        contentToSave !== undefined ? contentToSave : content;

      if (!contentToUse) {
        return false;
      }

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
