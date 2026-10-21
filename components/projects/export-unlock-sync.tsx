'use client';

import { useEffect } from 'react';

import { useExportUnlockReturn } from '@/hooks/use-export-unlock-return';
import { ProjectActions } from '@/stores/project';

/**
 * Puts the project layout's server-side export unlock read into the project
 * store (the toolbar's export gate reads it), and handles the return from
 * an `export_single` checkout (`?export=unlocked`). Renders nothing.
 */
export function ExportUnlockSync({
  projectId,
  exportUnlocked,
}: {
  projectId: string;
  exportUnlocked: boolean;
}) {
  // Declared before the return hook so the store holds the server value
  // when that hook decides whether to poll.
  useEffect(() => {
    ProjectActions.setExportUnlocked(projectId, exportUnlocked);
  }, [projectId, exportUnlocked]);

  useExportUnlockReturn(projectId);

  return null;
}
