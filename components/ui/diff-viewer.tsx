'use client';

interface DiffViewerProps {
  original: string;
  suggested: string;
  startLine?: number;
  className?: string;
}

export function DiffViewer({
  original,
  suggested,
  startLine,
  className = '',
}: DiffViewerProps) {
  const originalLines = original ? original.split('\n') : [];
  const suggestedLines = suggested ? suggested.split('\n') : [];

  return (
    <div
      className={`max-h-64 max-w-full overflow-y-auto rounded-lg border border-gray-200 bg-white font-mono text-xs scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 ${className}`}
    >
      {originalLines.length > 0 && (
        <div className="bg-red-50/50">
          {originalLines.map((line, index) => (
            <div
              key={`del-${index}`}
              className="border-l-3 flex border-red-400"
            >
              {startLine !== undefined && (
                <span className="min-w-[32px] flex-shrink-0 select-none border-r border-red-200 bg-red-100/70 px-1.5 py-2 text-right tabular-nums text-red-400">
                  {startLine + index}
                </span>
              )}
              <span className="min-w-[24px] flex-shrink-0 border-r border-red-200 bg-red-100 px-2 py-2 text-center text-red-600">
                −
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap break-all px-3 py-2 text-red-700">
                {line || '\u00A0'}
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestedLines.length > 0 && (
        <div className="bg-green-50/50">
          {suggestedLines.map((line, index) => (
            <div
              key={`add-${index}`}
              className="border-l-3 flex border-green-400"
            >
              {startLine !== undefined && (
                <span className="min-w-[32px] flex-shrink-0 select-none border-r border-green-200 bg-green-100/70 px-1.5 py-2 text-right tabular-nums text-green-400">
                  {startLine + index}
                </span>
              )}
              <span className="min-w-[24px] flex-shrink-0 border-r border-green-200 bg-green-100 px-2 py-2 text-center text-green-600">
                +
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap break-all px-3 py-2 text-green-700">
                {line || '\u00A0'}
              </div>
            </div>
          ))}
        </div>
      )}

      {originalLines.length === 0 && suggestedLines.length === 0 && (
        <div className="bg-gray-50/50 px-4 py-3 text-center italic text-gray-500">
          No changes to display
        </div>
      )}
    </div>
  );
}
