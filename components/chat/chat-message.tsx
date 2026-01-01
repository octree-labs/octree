import { type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import LatexRenderer from '../latex-renderer';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion';
import { Button } from '../ui/button';
import { DiffViewer } from '../ui/diff-viewer';
import { ProposalIndicator } from './proposal-indicator';
import { ProposalIndicator as ProposalIndicatorType } from './use-edit-proposals';
import { EditSuggestion } from '@/types/edit';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatMessageProps {
  message: ChatMessage;
  isLoading?: boolean;
  proposalIndicator?: ProposalIndicatorType;
  textFromEditor?: string | null;
  suggestions?: EditSuggestion[];
  onAcceptEdit?: (suggestionId: string) => void;
  onRejectEdit?: (suggestionId: string) => void;
}

function renderMessageContent(content: string): ReactNode {
  const incompleteLatexDiffMatch = content.match(
    /```latex-diff(?!\n[\s\S]*?\n```)/
  );
  const latexDiffRegex = /```latex-diff\n([\s\S]*?)\n```/g;
  const hasLatexDiff = content.includes('```latex-diff');

  if (!hasLatexDiff) {
    return (
      <div className="whitespace-pre-wrap break-words">
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

// Helper to get display info for suggestions
function getSuggestionInfo(suggestion: EditSuggestion) {
  const startLine = suggestion.position?.line || 1;
  const lineCount = suggestion.originalLineCount || 1;
  const suggestedText = suggestion.editType === 'delete' ? '' : (suggestion.content || '');
  
  return { startLine, lineCount, suggestedText };
}

// Inline suggestion component with collapsible diff
function InlineSuggestion({
  suggestion,
  onAccept,
  onReject,
}: {
  suggestion: EditSuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { startLine, lineCount, suggestedText } = getSuggestionInfo(suggestion);
  const isPending = suggestion.status === 'pending';
  const targetFile = suggestion.targetFile;
  
  if (!isPending) return null;

  return (
    <div className="rounded-md border border-blue-200 bg-white overflow-hidden text-[11px]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-slate-500 flex-shrink-0" />
          )}
          {targetFile && (
            <span className="text-[9px] font-medium text-slate-600 bg-slate-100 px-1 py-0.5 rounded truncate max-w-[100px]" title={targetFile}>
              {targetFile}
            </span>
          )}
          <span className="font-medium text-blue-700 flex-shrink-0">
            L{startLine}
            {lineCount > 1 && `-${startLine + lineCount - 1}`}
          </span>
          {suggestion.editType === 'delete' && (
            <span className="text-[9px] font-medium text-red-600 bg-red-50 px-1 py-0.5 rounded flex-shrink-0">
              DEL
            </span>
          )}
          {suggestion.editType === 'insert' && (
            <span className="text-[9px] font-medium text-green-600 bg-green-50 px-1 py-0.5 rounded flex-shrink-0">
              INS
            </span>
          )}
          {suggestion.editType === 'replace' && (
            <span className="text-[9px] font-medium text-amber-600 bg-amber-50 px-1 py-0.5 rounded flex-shrink-0">
              REP
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAccept(suggestion.id);
            }}
            className="h-5 px-1.5 flex items-center rounded border border-green-200 text-green-700 hover:border-green-300 hover:bg-green-50"
          >
            <Check size={10} className="mr-0.5" />
            Accept
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReject(suggestion.id);
            }}
            className="h-5 px-1.5 flex items-center rounded border border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
          >
            <X size={10} className="mr-0.5" />
            Reject
          </button>
        </div>
      </div>
      
      {isExpanded && (
        <div className="px-2 pb-2">
          <DiffViewer
            original={suggestion.original ?? ''}
            suggested={suggestedText}
            className="max-w-full"
          />
          {suggestion.explanation && (
            <p className="mt-1.5 text-[10px] text-slate-600 italic">
              {suggestion.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatMessageComponent({
  message,
  isLoading,
  proposalIndicator,
  textFromEditor,
  suggestions = [],
  onAcceptEdit,
  onRejectEdit,
}: ChatMessageProps) {
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
  
  return (
    <div
      className={cn(
        'shadow-xs mb-4 min-w-0 break-words rounded-lg border',
        message.role === 'assistant'
          ? 'border-slate-200 bg-gradient-to-br from-blue-50 to-blue-50/50 p-3'
          : 'border-slate-200 bg-white p-3'
      )}
    >
      <div className="mb-1 text-sm font-semibold text-blue-800">
        {message.role === 'assistant' ? 'Octra' : 'You'}
      </div>

      <div className="min-w-0 overflow-hidden whitespace-pre-wrap break-words text-sm text-slate-800">
        {message.role === 'assistant' && !message.content && isLoading ? (
          <div className="flex items-end gap-1.5">
            <span className="animate-pulse text-sm text-slate-500">
              Thinking
            </span>
            <div className="flex items-center space-x-0.5 pb-1">
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]"></div>
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]"></div>
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-400"></div>
            </div>
          </div>
        ) : (
          renderMessageContent(message.content)
        )}
      </div>

      {message.role === 'assistant' && !textFromEditor && proposalIndicator && (
        <div className="mt-3 border-t border-blue-100 pt-3">
          <ProposalIndicator indicator={proposalIndicator} />
        </div>
      )}

      {message.role === 'assistant' && pendingSuggestions.length > 0 && onAcceptEdit && onRejectEdit && (
        <div className="mt-3 space-y-2 border-t border-blue-100 pt-3">
          {pendingSuggestions.map((suggestion) => (
            <InlineSuggestion
              key={suggestion.id}
              suggestion={suggestion}
              onAccept={onAcceptEdit}
              onReject={onRejectEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
