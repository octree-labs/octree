'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUp,
  Loader2,
  FileText,
  Paperclip,
  X,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { BackButton } from '@/components/projects/back-button';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';
import {
  GenerateActions,
  type GeneratedDocument,
} from '@/stores/generate';
import { WelcomeState } from '@/components/generate/WelcomeState';
import { MessageBubble, type Message } from '@/components/generate/MessageBubble';
import { DocumentPreview } from '@/components/generate/DocumentPreview';
import { useGenerate, type AttachedFile } from '@/hooks/use-generate';
import { useAutoScroll } from '@/hooks/use-auto-scroll';

const AutoScrollDiv = memo(function AutoScrollDiv({ messages }: { messages: Message[] }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);
  return <div ref={messagesEndRef} />;
});

const ChatSkeleton = memo(function ChatSkeleton() {
  return (
    <div className="p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex justify-end">
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Card className="overflow-hidden">
          <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-[200px] w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
});

interface AttachedFilesListProps {
  files: AttachedFile[];
  onRemove: (id: string) => void;
}

const AttachedFilesList = memo(function AttachedFilesList({ files, onRemove }: AttachedFilesListProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-1">
      {files.map((f) => (
        <div
          key={f.id}
          className="group relative flex h-14 items-center gap-2 rounded-md border bg-muted/50 px-2"
        >
          {f.type === 'image' && f.preview ? (
            <img
              src={f.preview}
              alt={f.file.name}
              className="h-10 w-10 rounded object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="max-w-[120px] truncate text-xs text-muted-foreground">
            {f.file.name}
          </span>
          <button
            type="button"
            onClick={() => onRemove(f.id)}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove file"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
});

interface GeneratePageContentProps {
  initialDocument?: GeneratedDocument;
}

export function GeneratePageContent({ initialDocument }: GeneratePageContentProps) {
  const router = useRouter();

  const handleDocumentCreated = useCallback((documentId: string) => {
    router.replace(`/generate/${documentId}`, { scroll: false });
  }, [router]);

  const {
    prompt,
    setPrompt,
    messages,
    isGenerating,
    error,
    setError,
    attachedFiles,
    fileInputRef,
    handleFileSelect,
    addFiles,
    handleRemoveFile,
    generateDocument,
    resetState,
    restoreSession,
    currentDocument,
  } = useGenerate({ onDocumentCreated: handleDocumentCreated });

  const scrollRef = useAutoScroll<HTMLDivElement>();
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const currentSessionId = useRef<string | null>(null);
  const isInitialLoad = initialDocument && currentSessionId.current !== initialDocument.id;

  useEffect(() => {
    if (initialDocument && currentSessionId.current !== initialDocument.id) {
      currentSessionId.current = initialDocument.id;
      restoreSession(initialDocument);
    }
  }, [initialDocument, restoreSession]);

  const currentLatex = currentDocument?.latex ?? null;
  const currentTitle = currentDocument?.title ?? 'Untitled Document';

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files?.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  }, [addFiles]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateDocument();
    }
  }, [generateDocument]);

  const handleOpenInOctree = useCallback(async () => {
    if (!currentLatex || isCreatingProject) return;

    setIsCreatingProject(true);
    try {
      const result = await createProjectFromLatex(currentTitle, currentLatex);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.projectId) {
        router.push(`/projects/${result.projectId}`);
      }
    } catch {
      setError('Failed to create project');
      setIsCreatingProject(false);
    }
  }, [currentLatex, currentTitle, isCreatingProject, router, setError]);

  const handleDocumentSelect = useCallback((doc: GeneratedDocument) => {
    if (!doc.latex) return;
    if (currentSessionId.current === doc.id) return;
    currentSessionId.current = doc.id;
    restoreSession(doc);
    router.push(`/generate/${doc.id}`);
  }, [router, restoreSession]);

  const handleNewChat = useCallback(() => {
    currentSessionId.current = null;
    resetState();
    router.push('/generate');
  }, [resetState, router]);

  const triggerFileInput = useCallback((accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  }, [fileInputRef]);

  return (
    <>
      <GenerateHistorySidebar
        onNewChat={handleNewChat}
        onSelectDocument={handleDocumentSelect}
      />
      <SidebarInset className="flex h-screen flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <BackButton />
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            {currentTitle}
          </div>
          <div className="w-8" />
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
            {error && (
              <div className="sticky top-0 z-50 p-4">
                <Card className="mx-auto max-w-3xl relative border-destructive bg-destructive/10 p-3 pr-10 shadow-lg">
                  <p className="text-sm text-destructive">{error}</p>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="absolute right-2 top-2 rounded-md p-1 hover:bg-destructive/20"
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </button>
                </Card>
              </div>
            )}

            {isInitialLoad ? (
              <ChatSkeleton />
            ) : !messages.length ? (
              <WelcomeState onSelectSuggestion={setPrompt} />
            ) : (
              <div className="p-4">
                <div className="mx-auto max-w-3xl space-y-4">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isStreaming={
                        message.role === 'assistant' &&
                        isGenerating &&
                        !message.content.startsWith('Document generated successfully.') &&
                        !error
                      }
                    />
                  ))}

                  {currentLatex && !isGenerating && (
                    <DocumentPreview
                      latex={currentLatex}
                      title={currentTitle}
                      onOpenInOctree={handleOpenInOctree}
                      isCreatingProject={isCreatingProject}
                    />
                  )}
                  
                  <AutoScrollDiv messages={messages} />
                </div>
              </div>
            )}
          </div>
        </main>

        <div className="shrink-0 border-t bg-background p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              generateDocument();
            }}
            className="mx-auto max-w-3xl"
          >
            <Card
              className={`flex flex-col gap-2 p-2 transition-colors ${isDragging ? 'border-primary ring-2 ring-primary/20 bg-muted/50' : ''
                }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <AttachedFilesList files={attachedFiles} onRemove={handleRemoveFile} />

              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe the document you want to create..."
                className="min-h-[60px] flex-1 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
                disabled={isGenerating}
              />

              <div className="flex items-center justify-between">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={isGenerating}
                    >
                      <Paperclip className="h-4 w-4" />
                      <span className="sr-only">Attach file</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => triggerFileInput('image/png,image/jpeg,image/gif,image/webp')}>
                      <ImageIcon className="mr-2 h-4 w-4" />
                      Image
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => triggerFileInput('application/pdf')}>
                      <FileIcon className="mr-2 h-4 w-4" />
                      PDF Document
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="submit"
                  size="icon"
                  variant="gradient"
                  disabled={!prompt.trim() || isGenerating}
                  className="h-8 w-8 shrink-0"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                  <span className="sr-only">Send prompt</span>
                </Button>
              </div>
            </Card>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />
          </form>
        </div>
      </SidebarInset>
    </>
  );
}
