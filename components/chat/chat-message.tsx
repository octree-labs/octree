import { type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2 } from 'lucide-react';
import LatexRenderer from '../latex-renderer';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion';
import { ProposalIndicator as ProposalIndicatorType } from './use-edit-proposals';
import { EditSuggestion } from '@/types/edit';
import { ChatProgressTracker } from './chat-progress-tracker';

export interface ToolBoundary {
  toolName: string;
  textIndex: number;
}

export interface ContentSegmentData {
  type: 'text' | 'tool-boundary';
  text: string;
  toolName?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatMessageProps {
  message: ChatMessage;
  isLoading?: boolean;
  proposalIndicator?: ProposalIndicatorType;
  hasGetContext?: boolean;
  textFromEditor?: string | null;
  suggestions?: EditSuggestion[];
  onAcceptEdit?: (suggestionId: string) => void;
  onRejectEdit?: (suggestionId: string) => void;
  toolBoundaries?: ToolBoundary[];
}

/**
 * Split message text into an ordered array of segments based on tool call boundaries.
 * Each segment is either a text block or a tool boundary marker, preserving all
 * interleaved text between multiple tool rounds.
 */
function splitContentIntoSegments(
  text: string,
  boundaries: ToolBoundary[]
): ContentSegmentData[] {
  if (!boundaries.length) {
    return [{ type: 'text', text }];
  }

  const segments: ContentSegmentData[] = [];
  let lastIndex = 0;

  for (const boundary of boundaries) {
    // Text before this boundary
    const segmentText = text.slice(lastIndex, boundary.textIndex);
    if (segmentText.trim()) {
      segments.push({ type: 'text', text: segmentText });
    }
    // Record the boundary itself
    segments.push({ type: 'tool-boundary', text: '', toolName: boundary.toolName });
    lastIndex = boundary.textIndex;
  }

  // Text after last boundary
  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    segments.push({ type: 'text', text: remaining });
  }

  return segments;
}

function renderMessageContent(content: string): ReactNode {
  const incompleteLatexDiffMatch = content.match(
    /```latex-diff(?!\n[\s\S]*?\n```)/
  );
  const latexDiffRegex = /```latex-diff\n([\s\S]*?)\n```/g;
  const hasLatexDiff = content.includes('```latex-diff');

  if (!hasLatexDiff) {
    return (
      <div className="break-words">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = latexDiffRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <div
          key={`text-before-${match.index}`}
          className="mb-2 whitespace-pre-wrap"
        >
          <ReactMarkdown>{content.slice(lastIndex, match.index)}</ReactMarkdown>
        </div>
      );
    }

    const isComplete = match[1] && match[1].trim().length > 0;

    parts.push(
      <div key={`latex-${match.index}`} className="my-2">
        <Accordion type="single" collapsible className="rounded-md border">
          <AccordionItem value="latex-diff" className="border-none">
            <AccordionTrigger className="px-3 py-1 text-xs font-medium text-slate-600 hover:no-underline">
              <div className="flex items-center gap-2">
                {!isComplete && <Loader2 className="h-3 w-3 animate-spin" />}
                LaTeX Diff
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-2">
              <LatexRenderer latex={match[1]} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    );

    lastIndex = match.index + match[0].length;
  }

  if (incompleteLatexDiffMatch) {
    const incompleteIndex = incompleteLatexDiffMatch.index!;

    if (incompleteIndex > lastIndex) {
      parts.push(
        <div
          key={`text-before-incomplete`}
          className="mb-2 whitespace-pre-wrap"
        >
          <ReactMarkdown>
            {content.slice(lastIndex, incompleteIndex)}
          </ReactMarkdown>
        </div>
      );
    }

    parts.push(
      <div
        key="latex-incomplete"
        className="my-2 flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-medium text-slate-600 duration-500 animate-in fade-in-0 slide-in-from-bottom-2"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        LaTeX Diff
      </div>
    );

    return parts;
  }

  if (lastIndex < content.length) {
    parts.push(
      <div key={`text-after-${lastIndex}`} className="mt-2 whitespace-pre-wrap">
        <ReactMarkdown>{content.slice(lastIndex)}</ReactMarkdown>
      </div>
    );
  }

  return parts;
}

export function ChatMessageComponent({
  message,
  isLoading,
  proposalIndicator,
  hasGetContext,
  textFromEditor,
  suggestions = [],
  onAcceptEdit,
  onRejectEdit,
  toolBoundaries,
}: ChatMessageProps) {
  const acceptedSuggestions = suggestions.filter((s) => s.status === 'accepted');

  // Split content into ordered segments based on tool call boundaries
  const contentSegments = useMemo(() => {
    if (!message.content) {
      return [];
    }

    const rawSegments = splitContentIntoSegments(
      message.content,
      toolBoundaries || []
    );

    // Render text segments into ReactNodes
    return rawSegments.map((seg) => ({
      ...seg,
      renderedContent: seg.type === 'text' && seg.text.trim()
        ? renderMessageContent(seg.text.trim())
        : null,
    }));
  }, [message.content, toolBoundaries]);

  if (message.role === 'user') {
    return (
      <div className="shadow-xs mb-4 min-w-0 break-words rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-1 text-sm font-semibold text-blue-800">You</div>
        {message.content && (
          <div className="min-w-0 overflow-hidden whitespace-pre-wrap break-words text-sm text-slate-800">
            {renderMessageContent(message.content)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="shadow-xs mb-4 min-w-0 break-words rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-50/50 p-3">
      <div className="mb-1 text-sm font-semibold text-blue-800">Octra</div>

      <ChatProgressTracker
        hasContent={!!message.content}
        isLoading={!!isLoading}
        proposalIndicator={proposalIndicator}
        hasGetContext={hasGetContext}
        segments={contentSegments}
        acceptedEdits={acceptedSuggestions}
      />

    </div>
  );
}
