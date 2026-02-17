'use client';

import { useMemo } from 'react';
import { List } from 'lucide-react';

interface OutlineItem {
  title: string;
  line: number;
  depth: number;
}

interface OutlinePanelProps {
  fileContent: string;
  onJumpToLine: (line: number) => void;
}

const SECTION_COMMANDS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

function parseOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = content.split('\n');
  const pattern = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*\{([^}]*)\}/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (match) {
      const command = match[1];
      const title = match[2].trim();
      if (title) {
        items.push({
          title,
          line: i + 1,
          depth: SECTION_COMMANDS[command],
        });
      }
    }
  }

  // Normalize depths so the minimum depth used is 0
  if (items.length > 0) {
    const minDepth = Math.min(...items.map((item) => item.depth));
    for (const item of items) {
      item.depth -= minDepth;
    }
  }

  return items;
}

export function OutlinePanel({ fileContent, onJumpToLine }: OutlinePanelProps) {
  const items = useMemo(() => parseOutline(fileContent), [fileContent]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-3 px-4 text-center">
        <List className="h-8 w-8 text-slate-300" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-600">No sections found</p>
          <p className="text-xs text-slate-400">
            Add \section, \subsection, or other heading commands to your LaTeX file
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300">
        <div className="space-y-0.5">
          {items.map((item, i) => (
            <button
              key={`${item.line}-${i}`}
              onClick={() => onJumpToLine(item.line)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-100"
              style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
            >
              <span className="truncate text-slate-700">{item.title}</span>
              <span className="ml-auto flex-shrink-0 pl-2 text-[11px] text-slate-400">
                L{item.line}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
