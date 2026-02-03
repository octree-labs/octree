'use client';

import { useEffect } from 'react';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';
import { GenerateActions, type GeneratedDocument } from '@/stores/generate';

interface GenerateSessionContentProps {
  initialDocument: GeneratedDocument;
}

export function GenerateSessionContent({ initialDocument }: GenerateSessionContentProps) {
  useEffect(() => {
    GenerateActions.setActiveDocument(initialDocument.id);

    GenerateActions.fetchDocuments().then(() => {
      const state = GenerateActions.fetchDocument(initialDocument.id);
      if (!state) {
        GenerateActions.addDocument(initialDocument);
      }
    });
  }, [initialDocument]);

  return <GeneratePageContent initialDocument={initialDocument} />;
}
