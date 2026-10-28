import { useRef, useImperativeHandle, forwardRef, type FormEvent, useLayoutEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X, ArrowUp, Loader2, Upload, Square, Trash2 } from 'lucide-react';
import { FileAttachment } from '@/types/attachment';
import { MAX_FILE_SIZE } from '@/types/attachment';
import { AttachmentUpload } from './attachment-upload';
import { AttachmentList } from './attachment-list';

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  textFromEditor: string | null;
  attachments?: FileAttachment[];
  canAddMoreAttachments?: boolean;
  hasMessages?: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClearEditor: () => void;
  onStop: () => void;
  onFilesSelected?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onResetError?: () => void;
  onClearHistory?: () => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
  /** Bottom-left of the input box, opposite the send button (the AI edit allowance). */
  footerStart?: React.ReactNode;
}

export interface ChatInputRef {
  focus: () => void;
}

const MAX_INPUT_HEIGHT = 240;

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  (
    {
      input,
      isLoading,
      textFromEditor,
      attachments = [],
      canAddMoreAttachments = true,
      hasMessages = false,
      onInputChange,
      onSubmit,
      onClearEditor,
      onStop,
      onFilesSelected,
      onRemoveAttachment,
      onResetError,
      onClearHistory,
      formRef,
      footerStart,
    },
    ref
  ) => {
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Grow with the text (typed or a filled-in draft) up to a cap, then scroll.
    useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    }, [input]);

    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
    }));

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const formEvent = new Event('submit', {
          bubbles: true,
          cancelable: true,
        });

        const form = e.currentTarget.form;

        if (form) {
          form.dispatchEvent(formEvent);
        }
      }
    };

    const onDrop = (acceptedFiles: File[]) => {
      if (
        acceptedFiles.length > 0 &&
        canAddMoreAttachments &&
        onFilesSelected
      ) {
        onFilesSelected(acceptedFiles);
      }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
      onDrop,
      maxSize: MAX_FILE_SIZE,
      multiple: true,
      disabled: isLoading || !canAddMoreAttachments || !onFilesSelected,
      noClick: true,
      noKeyboard: true,
    });

    return (
      <div className="relative px-2 pb-2">
        {textFromEditor && (
          <div className="shadow-xs pointer-events-auto absolute left-1/2 top-0 z-10 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-full rounded-t-md border border-b-0 border-slate-300 bg-slate-50 px-2 py-1 text-xs">
            <Button
              onClick={onClearEditor}
              size="icon"
              variant="ghost"
              className="absolute right-0 top-0 size-5 text-slate-500 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="size-3" />
            </Button>
            <p className="text-slate-500">Attached From Editor</p>
            <code className="block max-h-20 overflow-x-hidden overflow-y-scroll whitespace-pre scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300">
              {textFromEditor}
            </code>
          </div>
        )}

        <form
          ref={formRef}
          onSubmit={(event) => {
            onResetError?.();
            onSubmit(event);
          }}
          {...getRootProps()}
          className="relative flex w-full flex-col gap-2 rounded-md border p-2"
        >
          <input {...getInputProps()} />

          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-blue-500 bg-blue-50/90 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-blue-600" />
                <span className="text-sm font-medium text-blue-600">
                  Drop files hereasdas
                </span>
              </div>
            </div>
          )}

          {attachments.length > 0 && onRemoveAttachment && (
            <AttachmentList
              attachments={attachments}
              onRemove={onRemoveAttachment}
            />
          )}

          <Textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            placeholder="Prompt to edit your document..."
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[72px] w-full resize-none border-none p-1 shadow-none scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300 focus-visible:ring-0"
          />

          <div className="flex w-full items-center justify-between gap-2">
            <div className="min-w-0">{footerStart}</div>
            <div className="flex shrink-0 items-center gap-1">
              {onClearHistory && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={onClearHistory}
                  disabled={isLoading || !hasMessages}
                  className="size-6 rounded-full hover:text-red-600"
                  title="Clear chat history"
                  aria-label="Clear chat history"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}

              {onFilesSelected && (
                <AttachmentUpload
                  onFilesSelected={onFilesSelected}
                  disabled={isLoading}
                  canAddMore={canAddMoreAttachments}
                />
              )}

              {isLoading && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={onStop}
                  className="size-6 rounded-full"
                  aria-label="Stop streaming"
                >
                  <Square className="size-3 fill-primary text-primary" />
                </Button>
              )}

              <Button
                type="submit"
                size="icon"
                variant="default"
                disabled={isLoading}
                className="size-6 rounded-full"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp />
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    );
  }
);

ChatInput.displayName = 'ChatInput';
