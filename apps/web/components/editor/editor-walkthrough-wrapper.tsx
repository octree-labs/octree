'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorOnboarding } from '@/components/editor/editor-onboarding';
import { markEditorWalkthroughSeen } from '@/lib/requests/walkthrough';

interface EditorWalkthroughWrapperProps {
  children: React.ReactNode;
  userId: string | undefined;
  shouldShowEditorWalkthrough: boolean;
}

export function EditorWalkthroughWrapper({
  children,
  userId,
  shouldShowEditorWalkthrough,
}: EditorWalkthroughWrapperProps) {
  const [editorWalkthroughOpen, setEditorWalkthroughOpen] = useState(false);
  const markedRef = useRef(false);

  useEffect(() => {
    if (shouldShowEditorWalkthrough) {
      setEditorWalkthroughOpen(true);
    }
  }, [shouldShowEditorWalkthrough]);

  const handleComplete = useCallback(async () => {
    if (markedRef.current || !userId) return;
    markedRef.current = true;
    try {
      await markEditorWalkthroughSeen(userId);
    } catch (error) {
      console.error('Failed to mark editor walkthrough as seen:', error);
    }
  }, [userId]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && userId) {
        handleComplete();
      }
      setEditorWalkthroughOpen(open);
    },
    [userId, handleComplete]
  );

  return (
    <>
      {children}
      <EditorOnboarding
        open={editorWalkthroughOpen}
        onOpenChange={handleOpenChange}
        onComplete={handleComplete}
      />
    </>
  );
}
