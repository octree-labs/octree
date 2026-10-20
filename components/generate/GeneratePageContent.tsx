'use client';

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowUp,
  Loader2,
  FileText,
  Paperclip,
  X,
  Image as ImageIcon,
  File as FileIcon,
  Square,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { BackButton } from '@/components/projects/back-button';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import {
  GenerateActions,
  type GeneratedDocument,
} from '@/stores/generate';
import { WelcomeState } from '@/components/generate/WelcomeState';
import { MessageBubble, type Message } from '@/components/generate/MessageBubble';
import { DocumentPreview } from '@/components/generate/DocumentPreview';
import { useGenerate, type AttachedFile } from '@/hooks/use-generate';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { GenerateOnboarding } from '@/components/generate/generate-onboarding';
import { markGenerateWalkthroughSeen } from '@/lib/requests/walkthrough';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { canUseFeature } from '@/lib/subscription/features';
import { PaywallActions } from '@/stores/paywall';
import { AnalyticsEvents, generateEntryFromParam, type GenerateEntry } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';

const GENERATE_ONBOARDING_STORAGE_KEY = 'octree_generate_onboarding_completed';
const SUCCESS_MESSAGE_PREFIX = 'Document generated successfully.';

interface GeneratePageContentProps {
  userId?: string;
  shouldShowGenerateWalkthrough?: boolean;
  initialDocument?: GeneratedDocument | null;
}

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

export function GeneratePageContent({
  userId,
  shouldShowGenerateWalkthrough = false,
  initialDocument = null,
}: GeneratePageContentProps = {}) {
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
    stopGeneration,
    resetState,
    restoreSession,
    currentDocument,
    generationMilestone,
    retry,
    canRetry,
  } = useGenerate({ onDocumentCreated: handleDocumentCreated });

  // Generate is Pro-only: free users can see the page, but submitting opens
  // the paywall. The send button stays disabled until the plan is known.
  const {
    usage: subscriptionUsage,
    isLoading: isPlanLoading,
    refresh: refreshPlan,
  } = useSubscriptionUsage();
  const generateAccess = useMemo(
    () => canUseFeature(subscriptionUsage, 'generate'),
    [subscriptionUsage]
  );

  // Allowance badge: "1 free generation" for a new free account, then the
  // bought credits. Nothing for Pro (unlimited) or once everything is spent
  // (submitting opens the paywall with both offers).
  const allowanceLabel = useMemo(() => {
    if (!subscriptionUsage || subscriptionUsage.isPro || subscriptionUsage.hasUnlimitedEdits) {
      return null;
    }
    const free = subscriptionUsage.freeGenerationsRemaining ?? 0;
    if (free > 0) return `${free} free generation${free === 1 ? '' : 's'}`;
    const credits = subscriptionUsage.generationCredits ?? 0;
    if (credits > 0) return `${credits} generation credit${credits === 1 ? '' : 's'}`;
    return null;
  }, [subscriptionUsage]);

  // `/generate?from=onboarding|dashboard` says which card sent the visitor.
  // Read once on mount: the first submission on this page carries it. After a
  // generation `router.replace('/generate/<id>')` remounts this component, so
  // continuation submits report `direct`, which is all the funnel needs.
  const entryRef = useRef<GenerateEntry>('direct');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    entryRef.current = generateEntryFromParam(new URLSearchParams(window.location.search).get('from'));
  }, []);

  // Back from the $2.99 Checkout (`/generate?purchased=1`). The webhook that
  // grants the credit can land a moment after the redirect, so re-read the
  // allowance now and once more shortly after.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('purchased') !== '1') return;
    params.delete('purchased');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    toast.success('Payment received. Your generation credit will show up in a moment.');
    void refreshPlan();
    const t = setTimeout(() => void refreshPlan(), 3000);
    return () => clearTimeout(t);
  }, [refreshPlan]);

  const submitPrompt = useCallback(() => {
    if (isPlanLoading) return;
    if (generateAccess.allowed) {
      track(AnalyticsEvents.GENERATE_SUBMITTED, {
        attachment_count: attachedFiles.length,
        is_continuation: Boolean(currentDocument),
        entry: entryRef.current,
      });
      generateDocument();
      return;
    }
    if (generateAccess.reason === 'unknown') {
      // The status request failed: don't paywall a possibly-Pro user.
      toast.error("Couldn't check your plan. Please try again.");
      void refreshPlan();
      return;
    }
    // Free generation and credits are spent: sell Pro or a single credit.
    PaywallActions.open('generate', 'generate_quota', ['pro', 'single']);
  }, [
    isPlanLoading,
    generateAccess,
    generateDocument,
    refreshPlan,
    attachedFiles.length,
    currentDocument,
  ]);

  const scrollRef = useAutoScroll<HTMLDivElement>();
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [generateWalkthroughOpen, setGenerateWalkthroughOpen] = useState(false);
  const markedGenerateWalkthroughRef = useRef(false);

  useEffect(() => {
    const fromServer = shouldShowGenerateWalkthrough;
    const fromStorage = !localStorage.getItem(GENERATE_ONBOARDING_STORAGE_KEY);
    if (fromServer || fromStorage) {
      const t = setTimeout(() => setGenerateWalkthroughOpen(true), 350);
      return () => clearTimeout(t);
    }
  }, [shouldShowGenerateWalkthrough]);

  const currentSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (initialDocument && currentSessionId.current !== initialDocument.id) {
      currentSessionId.current = initialDocument.id;
      restoreSession(initialDocument);
    }
  }, [initialDocument, restoreSession]);

  useEffect(() => {
    if (!initialDocument && currentSessionId.current) {
      stopGeneration();
      currentSessionId.current = null;
      resetState();
    }
  }, [initialDocument, resetState, stopGeneration]);

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
      submitPrompt();
    }
  }, [submitPrompt]);

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
        track(AnalyticsEvents.PROJECT_CREATED, { source: 'generate' });
        router.push(`/projects/${result.projectId}`);
      }
    } catch {
      setError('Failed to create project');
      setIsCreatingProject(false);
    }
  }, [currentLatex, currentTitle, isCreatingProject, router, setError]);

  const triggerFileInput = useCallback((accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  }, [fileInputRef]);

  const handleGenerateWalkthroughComplete = useCallback(async () => {
    if (markedGenerateWalkthroughRef.current || !userId) return;
    markedGenerateWalkthroughRef.current = true;
    try {
      await markGenerateWalkthroughSeen(userId);
    } catch {}
  }, [userId]);

  const handleGenerateWalkthroughClose = useCallback(
    (open: boolean) => {
      if (!open) {
        localStorage.setItem(GENERATE_ONBOARDING_STORAGE_KEY, 'true');
        if (userId) {
          handleGenerateWalkthroughComplete();
        }
      }
      setGenerateWalkthroughOpen(open);
    },
    [userId, handleGenerateWalkthroughComplete]
  );

  return (
    <>
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 md:px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <BackButton />
          </div>
          <div
            className="text-sm font-medium text-muted-foreground truncate max-w-[200px] md:max-w-none"
            data-ph-mask=""
          >
            {currentTitle}
          </div>
          <div className="flex min-w-8 items-center justify-end">
            {allowanceLabel && (
              <Badge variant="secondary" data-testid="generate-allowance">
                {allowanceLabel}
              </Badge>
            )}
          </div>
        </header>

        {/* `data-ph-mask`: prompts, generated documents and the preview are masked in PostHog session replay. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30" data-ph-mask="">
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto"
            data-onboarding-target="generate-welcome"
          >
            {initialDocument && currentSessionId.current !== initialDocument.id ? (
              <ChatSkeleton />
            ) : !messages.length ? (
              <WelcomeState onSelectSuggestion={setPrompt} />
            ) : (
              <div className="p-2 md:p-4">
                <div className="mx-auto max-w-3xl space-y-4">
                  {messages.map((message, index) => {
                    const isLastAssistantStreaming =
                      index === messages.length - 1 &&
                      message.role === 'assistant' &&
                      isGenerating &&
                      !message.content.startsWith(SUCCESS_MESSAGE_PREFIX) &&
                      !error;
                    
                    const isLastMessage = index === messages.length - 1;

                    return (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isStreaming={isLastAssistantStreaming}
                        generationMilestone={isLastAssistantStreaming ? generationMilestone : undefined}
                        onRetry={isLastMessage ? retry : undefined}
                        canRetry={isLastMessage ? canRetry : false}
                      />
                    );
                  })}

                  <div data-onboarding-target="generate-preview">
                    {currentLatex && currentLatex.trim() !== '' && !isGenerating && (
                      <DocumentPreview
                        latex={currentLatex}
                        title={currentTitle}
                        onOpenInOctree={handleOpenInOctree}
                        isCreatingProject={isCreatingProject}
                        entry={entryRef.current}
                      />
                    )}
                  </div>
                  
                  <AutoScrollDiv messages={messages} />
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Same background as the messages above, with a divider between them. */}
        <div className="shrink-0 border-t bg-muted/30 p-2 md:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPrompt();
            }}
            className="mx-auto max-w-3xl"
          >
            <Card
              data-onboarding-target="generate-prompt"
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
                      data-onboarding-target="generate-attach"
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

                <div className="flex items-center gap-2">
                  {isGenerating && (
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      onClick={stopGeneration}
                      className="h-8 w-8 shrink-0 rounded-full"
                      aria-label="Stop generating"
                    >
                      <Square className="h-3 w-3 fill-primary text-primary" />
                    </Button>
                  )}
                  <Button
                    type="submit"
                    size="icon"
                    variant="gradient"
                    disabled={isGenerating || isPlanLoading || !prompt.trim()}
                    className="h-8 w-8 shrink-0 rounded-full"
                    data-onboarding-target="generate-send"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                    <span className="sr-only">
                      {isGenerating ? 'Generating...' : 'Send prompt'}
                    </span>
                  </Button>
                </div>
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

      <GenerateOnboarding
        open={generateWalkthroughOpen}
        onOpenChange={handleGenerateWalkthroughClose}
        onComplete={() => {
          localStorage.setItem(GENERATE_ONBOARDING_STORAGE_KEY, 'true');
          handleGenerateWalkthroughComplete();
        }}
      />
    </>
  );
}
