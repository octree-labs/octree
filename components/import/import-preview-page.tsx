'use client';

import '@/lib/promise-polyfill';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

interface ImportPreviewPageProps {
  pdf: Blob;
  /** Called when pdf.js cannot open the bytes the route returned. */
  onError: () => void;
}

/**
 * First page of the compiled draft as a canvas. pdf.js (already used by the
 * editor) renders the same on every browser, where an `<iframe>` of the PDF
 * is blank on Android Chrome and a download prompt on some iOS versions.
 */
export default function ImportPreviewPage({ pdf, onError }: ImportPreviewPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(0, Math.floor(node.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      {width ? (
        <Document
          file={pdf}
          options={options}
          onLoadError={onError}
          onSourceError={onError}
          loading={<div className="aspect-[1/1.3] w-full animate-pulse bg-muted" />}
          error={null}
        >
          <Page
            pageNumber={1}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={<div className="aspect-[1/1.3] w-full animate-pulse bg-muted" />}
            onRenderError={onError}
          />
        </Document>
      ) : null}
    </div>
  );
}
