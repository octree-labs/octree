'use client';

import { useEffect } from 'react';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';
import { GenerateActions, type GeneratedDocument, useGenerateStore } from '@/stores/generate';

interface GenerateSessionContentProps {
  initialDocument: GeneratedDocument;
}

export function GenerateSessionContent({ initialDocument }: GenerateSessionContentProps) {
  useEffect(() => {
    const state = useGenerateStore.getState();
    const exists = state.documents.some((d) => d.id === initialDocument.id);
    if (!exists) {
      GenerateActions.addDocumentWithoutActivating(initialDocument);
    }

    GenerateActions.fetchDocuments();
  }, [initialDocument]);

  return <GeneratePageContent initialDocument={initialDocument} />;
}
