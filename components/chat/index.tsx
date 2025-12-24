'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, X, CheckCheck } from 'lucide-react';
import { OctreeLogo } from '@/components/icons/octree-logo';
import { EditSuggestion } from '@/types/edit';
import { useChatStream } from './use-chat-stream';
import { useEditProposals } from './use-edit-proposals';
import { useFileAttachments } from './use-file-attachments';
import { ChatMessageComponent } from './chat-message';
import { ChatInput, ChatInputRef } from './chat-input';
import { EmptyState } from './empty-state';

interface ChatProps {
  onEditSuggestion: (edit: EditSuggestion | EditSuggestion[]) => void;
  onAcceptEdit: (suggestionId: string) => void;
  onRejectEdit: (suggestionId: string) => void;
  onAcceptAllEdits?: () => void;
  editSuggestions: EditSuggestion[];
  pendingEditCount?: number;
  fileContent: string;
  textFromEditor: string | null;
  setTextFromEditor: (text: string | null) => void;
  selectionRange?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  projectFiles?: Array<{ path: string; content: string }>;
  currentFilePath?: string | null;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  autoSendMessage?: string | null;
  setAutoSendMessage?: (message: string | null) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function Chat({
  isOpen,
  setIsOpen,
  onEditSuggestion,
  onAcceptEdit,
  onRejectEdit,
  onAcceptAllEdits,
  editSuggestions,
  pendingEditCount = 0,
  fileContent,
  textFromEditor,
  setTextFromEditor,
  selectionRange,
  projectFiles = [],
  currentFilePath = null,
  autoSendMessage,
  setAutoSendMessage,
}: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversionStatus, setConversionStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef<boolean>(true);
  const currentAssistantIdRef = useRef<string | null>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isOpen) {
      chatInputRef.current?.focus();
      scrollToBottom();
    }
  }, [isOpen]);

  useEffect(() => {
    if (autoSendMessage && isOpen && !isLoading) {
      setInput(autoSendMessage);

      if (setAutoSendMessage) {
        setAutoSendMessage(null);
      }
      setTimeout(() => {
        if (formRef.current) {
          formRef.current.requestSubmit();
        }
      }, 100);
    }
  }, [autoSendMessage]);

  const { startStream, parseStream, stopStream } = useChatStream();
  const {
    proposalIndicators,
    clearProposals,
    clearAllProposalsAndTimeouts,
    setPending,
    incrementProgress,
    setError: setProposalError,
    convertEditsToSuggestions,
  } = useEditProposals(fileContent);
  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    getAttachmentContext,
    canAddMore: canAddMoreAttachments,
    isProcessing: isProcessingAttachments,
  } = useFileAttachments();

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
      clearAllProposalsAndTimeouts();
    };
  }, [stopStream, clearAllProposalsAndTimeouts]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setError(null);

    // Store user input for display
    const userDisplayContent = trimmed;

    // Show user message immediately (just the text, not the extracted image content)
    const userMsg: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: userDisplayContent,
    };
    setMessages((prev) => [...prev, userMsg]);

    setInput('');
    clearAttachments(); // Clear attachments after sending

    // Now start processing (shows conversion status if images)
    setIsLoading(true);
    setConversionStatus(null);
    if (textFromEditor) {
      setTextFromEditor(null);
    }

    // Get attachment context (this extracts content from images using GPT-4o-mini)
    const attachmentContext = await getAttachmentContext((message) => {
      setConversionStatus(message);
    });

    // Clear conversion status - now Claude takes over
    setConversionStatus(null);

    // Build the actual content for Claude (with extracted image content)
    const userContentForClaude = attachmentContext
      ? `${trimmed}${attachmentContext}`
      : trimmed;

    clearProposals();

    const assistantId = `${Date.now()}-assistant`;
    currentAssistantIdRef.current = assistantId;

    try {
      // Create messages array with the actual content for Claude (including image analysis)
      const messagesForClaude = [
        ...messages, // All previous messages
        { ...userMsg, content: userContentForClaude }, // User message with enhanced content
      ];

      const { response, controller } = await startStream(
        messagesForClaude,
        fileContent,
        textFromEditor,
        selectionRange,
        {
          currentFilePath,
          projectFiles,
        },
        {
          onTextUpdate: (text) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: text } : m
              )
            );
            if (shouldStickToBottomRef.current) scrollToBottom();
          },
          onEdits: (edits) => {
            const suggestions = convertEditsToSuggestions(edits, assistantId);
            if (suggestions.length > 0) {
              onEditSuggestion(suggestions);
            }
          },
          onToolCall: (name, count, violations, progressIncrement) => {
            if (name === 'propose_edits') {
              const violationCount = Array.isArray(violations)
                ? violations.length
                : undefined;
              if (typeof count === 'number') {
                setPending(assistantId, count, violationCount);
              }
              if (typeof progressIncrement === 'number') {
                incrementProgress(assistantId, progressIncrement, true);
              }
            }
          },
          onError: (errorMsg) => {
            setError(new Error(errorMsg));
            setProposalError(assistantId, errorMsg);
          },
          onStatus: (state) => {
            if (state === 'started') setIsLoading(true);
          },
        }
      );

      if (!response.ok || !response.body) {
        let errorMessage = `Request failed with ${response.status}`;
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // Use default
        }

        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: 'assistant', content: '' },
        ]);
        setProposalError(assistantId, errorMessage);
        throw new Error(errorMessage);
      }

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      if (response.body) {
        const reader = response.body.getReader();
        await parseStream(reader, {
          onTextUpdate: (text) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: text } : m
              )
            );
            if (shouldStickToBottomRef.current) scrollToBottom();
          },
          onEdits: (edits) => {
            const suggestions = convertEditsToSuggestions(edits, assistantId);
            if (suggestions.length > 0) {
              onEditSuggestion(suggestions);
            }
          },
          onToolCall: (name, count, violations) => {
            if (name === 'propose_edits') {
              const violationCount = Array.isArray(violations)
                ? violations.length
                : undefined;
              setPending(assistantId, count, violationCount);
            }
          },
          onError: (errorMsg) => {
            setError(new Error(errorMsg));
            setProposalError(assistantId, errorMsg);
          },
          onStatus: (state) => {
            if (state === 'started') setIsLoading(true);
          },
        });
      }
    } catch (err) {
      console.error('Octra Agent API error:', err);
      if ((err as any)?.name !== 'AbortError') {
        setError(err);
      } else {
        // AbortError - user stopped it, remove incomplete message
        if (currentAssistantIdRef.current) {
          setMessages((prev) =>
            prev.filter((m) => m.id !== currentAssistantIdRef.current)
          );
        }
      }
    } finally {
      setIsLoading(false);
      setInput('');
      currentAssistantIdRef.current = null;
      window.dispatchEvent(new Event('usage-update'));
    }
  };

  useEffect(() => {
    if (error) {
      console.error('Chat error:', error);
    }
  }, [error]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) scrollToBottom();
  }, [messages, isLoading, conversionStatus]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      shouldStickToBottomRef.current =
        scrollTop + clientHeight >= scrollHeight - 80;
    };

    el.addEventListener('scroll', onScroll);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsOpen]);

  const clearHistory = () => {
    setMessages([]);
  };

  // Group suggestions by messageId
  const suggestionsByMessage = useMemo(() => {
    const map = new Map<string, EditSuggestion[]>();
    for (const suggestion of editSuggestions) {
      if (suggestion.messageId) {
        const existing = map.get(suggestion.messageId) || [];
        existing.push(suggestion);
        map.set(suggestion.messageId, existing);
      }
    }
    return map;
  }, [editSuggestions]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="flex items-center space-x-3">
          <OctreeLogo className="h-5 w-5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Octra</h3>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isLoading && (
            <div className="flex items-center pr-1" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            </div>
          )}
          {pendingEditCount > 1 && onAcceptAllEdits && (
            <Button
              size="sm"
              onClick={onAcceptAllEdits}
              disabled={isLoading}
              className="h-7 rounded-md bg-green-600 px-2 text-xs text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                isLoading
                  ? 'Wait for all edits to finish generating'
                  : 'Accept all pending edits'
              }
            >
              <CheckCheck size={12} className="mr-1" />
              Accept All ({pendingEditCount})
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className="h-7 w-7 rounded-md p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Close chat"
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300"
        >
          {messages.length === 0 && !isLoading && !conversionStatus && (
            <EmptyState />
          )}
          {messages.map((message) => (
            <ChatMessageComponent
              key={message.id}
              message={message}
              isLoading={isLoading}
              proposalIndicator={proposalIndicators[message.id]}
              textFromEditor={textFromEditor}
              suggestions={suggestionsByMessage.get(message.id) || []}
              onAcceptEdit={onAcceptEdit}
              onRejectEdit={onRejectEdit}
            />
          ))}

          {conversionStatus && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-medium">{conversionStatus}</span>
              </div>
            </div>
          )}
        </div>

        <ChatInput
          ref={chatInputRef}
          formRef={formRef}
          input={input}
          isLoading={isLoading}
          textFromEditor={textFromEditor}
          attachments={attachments}
          canAddMoreAttachments={canAddMoreAttachments}
          hasMessages={messages.length > 0}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onClearEditor={() => setTextFromEditor(null)}
          onStop={() => {
            console.log(
              '[Chat] Stop button clicked, currentAssistantId:',
              currentAssistantIdRef.current
            );

            stopStream();
            clearAllProposalsAndTimeouts();

            const messageIdToRemove = currentAssistantIdRef.current;
            if (messageIdToRemove) {
              setMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== messageIdToRemove);
                console.log(
                  '[Chat] Removed message, before:',
                  prev.length,
                  'after:',
                  filtered.length
                );
                return filtered;
              });
              currentAssistantIdRef.current = null;
            }

            setIsLoading(false);
            setConversionStatus(null);
            setError(null);
          }}
          onFilesSelected={addFiles}
          onRemoveAttachment={removeAttachment}
          onResetError={() => setError(null)}
          onClearHistory={clearHistory}
        />
      </div>
    </div>
  );
}
