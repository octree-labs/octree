import React from 'react';
import {
  AlertCircle,
  FileText,
  X,
  RefreshCw,
  WandSparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CompilationError } from '@/types/compilation';
import { formatCompilationErrorForClipboard } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface CompilationErrorProps {
  error: CompilationError;
  onRetry?: () => void;
  onDismiss?: () => void;
  onFixWithAI?: () => void;
  /**
   * Text of the "Fix with AI" button (e.g. "Missing package — Fix with AI",
   * lib/compile-error-fix.ts). When set, the button is also on the collapsed
   * error bar, not only behind "Show Details".
   */
  fixLabel?: string;
  className?: string;
  variant?: 'overlay' | 'bottom-bar';
}

export function CompilationError({
  error,
  onRetry,
  onDismiss,
  onFixWithAI,
  fixLabel,
  className,
  variant = 'overlay',
}: CompilationErrorProps) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const fixText = fixLabel ?? 'Fix with AI';
  // On the bar the error kind gives way first in a narrow PDF pane (phone,
  // pane dragged small): it truncates, "Fix with AI" and the dismiss button
  // stay visible and the bar stays one row (the PDF below is padded for one).
  const [fixKind, fixAction] = fixText.includes(' — ')
    ? [fixText.slice(0, fixText.lastIndexOf(' — ')), fixText.slice(fixText.lastIndexOf(' — ') + 3)]
    : [null, fixText];
  const barFixButton =
    onFixWithAI && fixLabel ? (
      <Button
        onClick={onFixWithAI}
        size="sm"
        variant="gradient"
        className="h-7 min-w-0 shrink gap-0 text-xs"
        aria-label={fixText}
        title={fixText}
        data-testid="compile-error-fix"
      >
        <WandSparkles className="mr-1 h-3 w-3" aria-hidden="true" />
        {fixKind && <span className="min-w-0 truncate">{fixKind}&nbsp;—&nbsp;</span>}
        <span className="shrink-0">{fixAction}</span>
      </Button>
    ) : null;

  if (variant === 'bottom-bar') {
    return (
      <div
        className={cn(
          'absolute left-0 right-0 top-0 z-30 border-b bg-white',
          className
        )}
      >
        {isCollapsed ? (
          <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span className="truncate text-sm font-medium text-red-700">
                Compiled with Errors
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {barFixButton}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(false)}
                className="h-7 text-xs text-red-600 hover:bg-red-100 hover:text-red-700"
              >
                <ChevronDown className="mr-1 h-3 w-3" />
                Show Details
              </Button>
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDismiss}
                  aria-label="Dismiss error"
                  className="h-7 w-7 shrink-0 p-0 text-red-400 hover:bg-red-100 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-auto">
            <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                <span className="truncate text-sm font-medium text-red-700">
                  Compiled with Errors
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {barFixButton}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsCollapsed(true)}
                  className="h-7 text-xs text-red-600 hover:bg-red-100 hover:text-red-700"
                >
                  <ChevronUp className="mr-1 h-3 w-3" />
                  Collapse
                </Button>
                {onDismiss && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDismiss}
                    aria-label="Dismiss error"
                    className="h-7 w-7 shrink-0 p-0 text-red-400 hover:bg-red-100 hover:text-red-700"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <p className="text-sm font-medium leading-relaxed text-slate-900">
                  {error.message}
                </p>
                {error.details && (
                  <p className="text-xs leading-relaxed text-slate-600">
                    {error.details}
                  </p>
                )}
                {error.summary && (
                  <div className="rounded-r border-l-2 border-red-500 bg-slate-50 p-3">
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700">
                      {error.summary}
                    </pre>
                  </div>
                )}
              </div>

              {error.code !== undefined && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                  >
                    Exit: {error.code}
                  </Badge>
                  {typeof error.queueMs === 'number' && (
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                    >
                      Queue: {error.queueMs}ms
                    </Badge>
                  )}
                  {typeof error.durationMs === 'number' && (
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                    >
                      Duration: {error.durationMs}ms
                    </Badge>
                  )}
                </div>
              )}

              {(error.log || error.stdout || error.stderr) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails(!showDetails)}
                  className="-ml-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <FileText className="mr-2 h-3 w-3" />
                  {showDetails ? 'Hide' : 'Show'} Technical Details
                </Button>
              )}

              {showDetails && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  {error.log && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                        LaTeX Log
                      </h4>
                      <pre className="max-h-32 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                        {error.log}
                      </pre>
                    </div>
                  )}
                  {error.stdout && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                        Output
                      </h4>
                      <pre className="max-h-32 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                        {error.stdout}
                      </pre>
                    </div>
                  )}
                  {error.stderr && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                        Error Stream
                      </h4>
                      <pre className="max-h-32 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                        {error.stderr}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 border-t border-slate-100 pt-3">
                {onFixWithAI && !fixLabel && (
                  <Button onClick={onFixWithAI} size="sm" variant="gradient" className="text-xs">
                    <WandSparkles className="mr-1 h-3 w-3" />
                    Fix with AI
                  </Button>
                )}
                {onRetry && (
                  <Button
                    onClick={onRetry}
                    variant="outline"
                    size="sm"
                    className="border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const errorText = formatCompilationErrorForClipboard(error);
                    navigator.clipboard.writeText(errorText);
                  }}
                  className="border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Copy Details
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'z-50 w-full px-4 py-6',
        !className && 'absolute inset-x-0 top-0',
        className
      )}
    >
      <Card className="bg-white shadow-xl backdrop-blur-sm">
        <CardHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500">
                <AlertCircle className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-lg font-semibold text-slate-900">
                Compilation Failed
              </CardTitle>
            </div>
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="h-8 w-8 shrink-0 p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="font-medium leading-relaxed text-slate-900">
              {error.message}
            </p>
            {error.details && (
              <p className="text-sm leading-relaxed text-slate-600">
                {error.details}
              </p>
            )}
            {error.summary && (
              <div className="rounded-r border-l-2 border-red-500 bg-slate-50 p-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-700">
                  {error.summary}
                </pre>
              </div>
            )}
          </div>

          {error.code !== undefined && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
              >
                Exit: {error.code}
              </Badge>
              {typeof error.queueMs === 'number' && (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                >
                  Queue: {error.queueMs}ms
                </Badge>
              )}
              {typeof error.durationMs === 'number' && (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                >
                  Duration: {error.durationMs}ms
                </Badge>
              )}
              {error.requestId && (
                <Badge
                  variant="outline"
                  className="max-w-full truncate border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                >
                  {error.requestId}
                </Badge>
              )}
            </div>
          )}

          {(error.log || error.stdout || error.stderr) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="-ml-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <FileText className="mr-2 h-4 w-4" />
              {showDetails ? 'Hide' : 'Show'} Technical Details
            </Button>
          )}

          {showDetails && (
            <div className="space-y-4 border-t border-slate-100 pt-4">
              {error.log && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                    LaTeX Log
                  </h4>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
                    {error.log}
                  </pre>
                </div>
              )}

              {error.stdout && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                    Output
                  </h4>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
                    {error.stdout}
                  </pre>
                </div>
              )}

              {error.stderr && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
                    Error Stream
                  </h4>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
                    {error.stderr}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {onFixWithAI && (
              <Button
                onClick={onFixWithAI}
                variant="gradient"
                className="flex-1 sm:flex-none"
                data-testid="compile-error-fix"
              >
                <WandSparkles className="h-4 w-4" aria-hidden="true" />
                {fixText}
              </Button>
            )}
            {onRetry && (
              <Button
                onClick={onRetry}
                variant="outline"
                className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 sm:flex-none"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const errorText = formatCompilationErrorForClipboard(error);
                navigator.clipboard.writeText(errorText);
              }}
              className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 sm:flex-none"
            >
              Copy Details
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
