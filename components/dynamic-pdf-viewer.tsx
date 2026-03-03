'use client';

import '@/lib/promise-polyfill';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { PageCallback } from 'react-pdf/dist/esm/shared/types.js';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { CompilationError } from '@/components/latex/compilation-error';
import { CompilationLoading } from '@/components/latex/compilation-loading';
import type { CompilationError as CompilationErrorType } from '@/types/compilation';
import type { SynctexForwardResult } from '@/lib/utils/synctex';

// Initialize the worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

interface PDFViewerProps {
  pdfData?: string | null;
  isLoading?: boolean;
  compilationError?: CompilationErrorType | null;
  onRetryCompile?: () => void;
  onDismissError?: () => void;
  onFixWithAI?: () => void;
  onReverseSync?: (page: number, h: number, v: number) => void;
  forwardSyncTarget?: SynctexForwardResult | null;
}

function DynamicPDFViewer({
  pdfData,
  isLoading = false,
  compilationError,
  onRetryCompile,
  onDismissError,
  onFixWithAI,
  onReverseSync,
  forwardSyncTarget,
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const wasInitialLoadingRef = useRef(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [pageDimensions, setPageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [syncHighlight, setSyncHighlight] = useState<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Forward sync: react to forwardSyncTarget changes
  useEffect(() => {
    if (!forwardSyncTarget || !pageDimensions) return;

    const { page, h, v, w, height } = forwardSyncTarget;
    scrollToPage(page);

    // Measure the actual rendered canvas to get accurate scale
    const pageDiv = pageRefs.current.get(page);
    const canvas = pageDiv?.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / pageDimensions.width;
    const scaleY = rect.height / pageDimensions.height;

    setSyncHighlight({
      page,
      x: h * scaleX,
      y: v * scaleY - height * scaleY,
      width: Math.max(w * scaleX, 200),
      height: Math.max(height * scaleY, 20),
    });

    const timer = setTimeout(() => setSyncHighlight(null), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwardSyncTarget]);

  // Track initial loading state to show success flash
  useEffect(() => {
    if (isLoading && !pdfData) {
      wasInitialLoadingRef.current = true;
    }
  }, [isLoading, pdfData]);

  // Show success flash when initial compile completes
  useEffect(() => {
    if (pdfData && wasInitialLoadingRef.current) {
      wasInitialLoadingRef.current = false;
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 800);
      return () => clearTimeout(timer);
    }
  }, [pdfData]);

  useEffect(() => {
    setZoom(1.0);
  }, [pdfData]);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !numPages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const page = Number(entry.target.getAttribute('data-page-number'));
            if (page) {
              setPageNumber(page);
              setPageInput(page.toString());
            }
          }
        });
      },
      {
        root: containerRef.current,
        threshold: 0.5,
      }
    );

    pageRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [numPages]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber(1);
  }

  function scrollToPage(targetPage: number) {
    const pageElement = pageRefs.current.get(targetPage);
    if (pageElement && containerRef.current) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPageNumber(targetPage);
      setPageInput(targetPage.toString());
    }
  }

  function handlePageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPageInput(e.target.value);
  }

  function handlePageInputBlur() {
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= (numPages || 1)) {
      scrollToPage(page);
    } else {
      setPageInput(pageNumber.toString());
    }
  }

  function handlePageInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }

  function changePage(offset: number) {
    const newPageNumber = Math.max(
      1,
      Math.min(numPages || 1, pageNumber + offset)
    );
    scrollToPage(newPageNumber);
  }

  function handleZoomIn() {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  }

  function handleZoomOut() {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  }

  function handleResetZoom() {
    setZoom(1.0);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          handleZoomIn();
        } else if (e.key === '-') {
          e.preventDefault();
          handleZoomOut();
        } else if (e.key === '0') {
          e.preventDefault();
          handleResetZoom();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function previousPage(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    changePage(-1);
  }

  function nextPage(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    changePage(1);
  }

  function onPageLoadSuccess(pageNum: number) {
    return (page: PageCallback) => {
      if (pageNum === 1) {
        const { width, height } = page.getViewport({ scale: 1 });
        setPageDimensions((prev) =>
          prev?.width === width && prev?.height === height
            ? prev
            : { width, height }
        );
      }
    };
  }

  function handlePageDoubleClick(pageNum: number, e: React.MouseEvent<HTMLDivElement>) {
    if (!onReverseSync || !pageDimensions) return;

    const pageDiv = e.currentTarget;
    const canvas = pageDiv.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Use the actual rendered canvas CSS size for accurate conversion
    const pdfH = (clickX / rect.width) * pageDimensions.width;
    const pdfV = (clickY / rect.height) * pageDimensions.height;

    onReverseSync(pageNum, pdfH, pdfV);
  }

  if (showSuccess && pdfData) {
    return <CompilationLoading completed />;
  }

  if (isLoading && !pdfData) {
    return <CompilationLoading />;
  }

  if (!pdfData) {
    if (compilationError) {
      return (
        <div className="relative h-full w-full bg-muted/10">
          <CompilationError
            error={compilationError}
            variant="overlay"
            onRetry={onRetryCompile}
            onDismiss={onDismissError}
            onFixWithAI={onFixWithAI}
            className="absolute left-1/2 top-1/2 z-10 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4"
          />
        </div>
      );
    }

    return (
      <p className="flex h-full items-center justify-center whitespace-pre text-sm text-slate-600">
        Click <span className="font-semibold">Compile</span> to see the PDF
        preview
      </p>
    );
  }

  // Create a data URL from the Base64 PDF
  const pdfUrl = `data:application/pdf;base64,${pdfData}`;

  const calculatePageWidth = () => {
    if (!pageDimensions) {
      return 595;
    }

    // I set it to 98% to account for padding and stuff
    return containerWidth * 0.8;
  };

  const pageWidth = calculatePageWidth();

  // Show error as bottom bar if there's both a PDF and an error
  const showErrorBottomBar = pdfData && compilationError;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Compilation Error Top Bar */}
      {showErrorBottomBar && (
        <CompilationError
          error={compilationError}
          variant="bottom-bar"
          onRetry={onRetryCompile}
          onDismiss={onDismissError}
          onFixWithAI={onFixWithAI}
        />
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
      )}
      {/* Main PDF viewer area with scrolling */}
      <div
        ref={containerRef}
        className="flex flex-1 justify-center overflow-auto py-2"
        style={{ paddingTop: showErrorBottomBar ? '60px' : undefined }}
      >
        <div className="flex flex-col items-center gap-4">
          <Document
            key={pdfData?.substring(0, 100)} // Force re-render when PDF data changes
            file={pdfUrl}
            options={options}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center p-4">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
              </div>
            }
          >
            {numPages &&
              Array.from(new Array(numPages), (_, index) => {
                const pageNum = index + 1;
                return (
                  <div
                    key={`page_${pageNum}`}
                    ref={(el) => {
                      if (el) {
                        pageRefs.current.set(pageNum, el);
                      }
                    }}
                    data-page-number={pageNum}
                    className="relative mb-4"
                    onDoubleClick={(e) => handlePageDoubleClick(pageNum, e)}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={pageWidth}
                      scale={zoom}
                      className="border border-slate-200 shadow-sm"
                      onLoadSuccess={onPageLoadSuccess(pageNum)}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
                        </div>
                      }
                    />
                    {syncHighlight && syncHighlight.page === pageNum && (
                      <div
                        className="animate-synctex-highlight pointer-events-none absolute rounded-sm bg-blue-400/30 ring-2 ring-blue-400/50"
                        style={{
                          left: `${syncHighlight.x}px`,
                          top: `${syncHighlight.y}px`,
                          width: `${syncHighlight.width}px`,
                          height: `${syncHighlight.height}px`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
          </Document>
        </div>
      </div>

      {/* Fixed controls at the bottom */}
      {pdfData && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 transform gap-2">
          {/* Zoom controls */}
          <div className="flex items-center rounded-md border border-slate-100 bg-white/90 px-1.5 py-1 shadow-md backdrop-blur-sm">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              className={`rounded-full p-0.5 transition-colors ${zoom <= MIN_ZOOM
                  ? 'text-slate-300'
                  : 'text-slate-500 hover:text-blue-500'
                }`}
              aria-label="Zoom out"
            >
              <ZoomOut size={16} />
            </button>

            <button
              onClick={handleResetZoom}
              className="mx-1 min-w-[3rem] rounded px-1.5 py-0.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-500"
              aria-label="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>

            <button
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className={`rounded-full p-0.5 transition-colors ${zoom >= MAX_ZOOM
                  ? 'text-slate-300'
                  : 'text-slate-500 hover:text-blue-500'
                }`}
              aria-label="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
          </div>

          {/* Pagination controls */}
          {numPages && numPages > 1 && (
            <div className="flex items-center rounded-md border border-slate-100 bg-white/90 px-1.5 py-1 shadow-md backdrop-blur-sm">
              <button
                onClick={previousPage}
                disabled={pageNumber <= 1}
                className={`rounded-full p-0.5 transition-colors ${pageNumber <= 1
                    ? 'text-slate-300'
                    : 'text-slate-500 hover:text-blue-500'
                  }`}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>

              <p className="mx-2 text-xs text-slate-600">
                <input
                  type="text"
                  value={pageInput}
                  onChange={handlePageInputChange}
                  onBlur={handlePageInputBlur}
                  onKeyDown={handlePageInputKeyDown}
                  className="w-8 rounded border border-sidebar-border bg-transparent text-center font-medium text-foreground focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label="Current page"
                />
                <span className="mx-1">/</span>
                <span>{numPages}</span>
              </p>

              <button
                onClick={nextPage}
                disabled={pageNumber >= numPages}
                className={`rounded-full p-0.5 transition-colors ${pageNumber >= numPages
                    ? 'text-slate-300'
                    : 'text-slate-400 hover:text-blue-500'
                  }`}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DynamicPDFViewer;
