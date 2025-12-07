'use client';

import '@/lib/promise-polyfill';
import { Loader2 } from 'lucide-react';
import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import dynamic from 'next/dynamic';
import PDFErrorBoundary from './pdf-error-boundary';
import type { CompilationError } from '@/types/compilation';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Dynamically import the PDF components with no SSR
const DynamicPDFViewer = dynamic(
  () => import('@/components/dynamic-pdf-viewer'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-slate-500">Loading PDF viewer...</span>
      </div>
    ),
  }
);

interface PDFViewerWrapperProps {
  pdfData?: string | null;
  pdfUrl?: string | null;
  isLoading?: boolean;
  compilationError?: CompilationError | null;
  onRetryCompile?: () => void;
  onDismissError?: () => void;
  onFixWithAI?: () => void;
}

function PDFViewerWrapper({
  pdfData,
  pdfUrl,
  isLoading,
  compilationError,
  onRetryCompile,
  onDismissError,
  onFixWithAI,
}: PDFViewerWrapperProps) {
  return (
    <PDFErrorBoundary>
      <DynamicPDFViewer
        pdfData={pdfData}
        pdfUrl={pdfUrl}
        isLoading={isLoading}
        compilationError={compilationError}
        onRetryCompile={onRetryCompile}
        onDismissError={onDismissError}
        onFixWithAI={onFixWithAI}
      />
    </PDFErrorBoundary>
  );
}

export default PDFViewerWrapper;
