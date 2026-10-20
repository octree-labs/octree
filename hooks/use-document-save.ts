'use client';

import { useEffect, useRef } from 'react';
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
  const { setIsSaving, setLastSaved, setHasUnsavedChanges } = SaveStatusActions;
  useEffect(() => SaveStatusActions.reset, []);

  // The latest edited content, so a save that finishes after newer typing
  // does not mark those newer edits as saved.
  const latestEditRef = useRef<string | null>(null);

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
      if (latestEditRef.current === null || latestEditRef.current === contentToUse) {
        setHasUnsavedChanges(false);
      }
      return true;
    } catch (error) {
      console.error('Error saving document:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const scheduleSave = useDebouncedCallback((content: string) => {
    handleSaveDocument(content);
  }, 1000);

  const debouncedSave = (content: string) => {
    latestEditRef.current = content;
    setHasUnsavedChanges(true);
    scheduleSave(content);
  };

  return {
    isSaving,
    lastSaved,
    handleSaveDocument,
    debouncedSave,
    setLastSaved,
  };
}
