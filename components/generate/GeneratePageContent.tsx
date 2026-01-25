'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  Loader2,
  FileText,
  Paperclip,
  X,
  Image as ImageIcon,
  File,
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
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { BackButton } from '@/components/projects/back-button';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';
import {
  useActiveDocument,
  useActiveDocumentId,
} from '@/stores/generate';
import { WelcomeState } from '@/components/generate/WelcomeState';
import { MessageBubble, Message, MessageAttachment } from '@/components/generate/MessageBubble';
import { DocumentPreview } from '@/components/generate/DocumentPreview';
import { useGenerate } from '@/hooks/use-generate';

export function GeneratePageContent() {
  const router = useRouter();

  const activeDocument = useActiveDocument();
  const activeDocumentId = useActiveDocumentId(); // Keep for consistency if used by other hooks implicitly, though we use activeDocument mostly

  const currentLatex = activeDocument?.latex ?? null;
  const currentTitle = activeDocument?.title ?? 'Untitled Document';

  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const {
    prompt,
    setPrompt,
    messages,
    setMessages,
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
  } = useGenerate();

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateDocument();
    }
  };

  const handleOpenInOctree = async () => {
    if (!currentLatex || isCreatingProject) return;

    setIsCreatingProject(true);
    try {
      const result = await createProjectFromLatex(currentTitle, currentLatex);

      if (result.error) {
        setError(result.error);
        return;
      }

      const projectId = result.projectId!;
      router.push(`/projects/${projectId}`);
    } catch {
      setError('Failed to create project');
      setIsCreatingProject(false);
    }
  };

  return (
    <>
      <GenerateHistorySidebar
        onNewChat={resetState}
        onSelectDocument={(doc) => {
          if (!doc.latex) return;
          setError(null);

          const restoredAttachments: MessageAttachment[] = (doc.attachments || []).map((att) => ({
            id: att.id,
            name: att.name,
            type: att.type,
            preview: att.url,
          }));

          setMessages([
            {
              id: `user-${doc.id}`,
              role: 'user',
              content: doc.prompt,
              attachments: restoredAttachments.length > 0 ? restoredAttachments : undefined,
            },
            {
              id: `assistant-${doc.id}`,
              role: 'assistant',
              content: 'Document generated successfully. Preview it below or open it in Octree.',
            },
          ]);
        }}
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
          <div className="w-8" /> {/* Spacer for centering */}
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
          {!messages.length ? (
            <WelcomeState onSelectSuggestion={setPrompt} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={
                      message.role === 'assistant' &&
                      isGenerating &&
                      message.content !==
                      'Document generated successfully. Preview it below or open it in Octree.' &&
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

                {error && !isGenerating && (
                  <Card className="border-destructive bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </Card>
                )}
                <AutoScrollDiv messages={messages} />
              </div>
            </div>
          )}

          <div className="shrink-0 border-t bg-background p-4">
            <form onSubmit={(e) => { e.preventDefault(); generateDocument(); }} className="mx-auto max-w-3xl">
              <Card
                className={`flex flex-col gap-2 p-2 transition-colors ${isDragging ? 'border-primary ring-2 ring-primary/20 bg-muted/50' : ''
                  }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Attached Files Preview */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-2 pt-1">
                    {attachedFiles.map((f) => (
                      <div
                        key={f.id}
                        className="group relative flex h-14 items-center gap-2 rounded-md border bg-muted/50 px-2"
                      >
                        {f.type === 'image' && f.preview ? (
                          <img
                            src={f.preview}
                            alt=""
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
                          onClick={() => handleRemoveFile(f.id)}
                          className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'image/png,image/jpeg,image/gif,image/webp';
                          fileInputRef.current.click();
                        }
                      }}>
                        <ImageIcon className="mr-2 h-4 w-4" />
                        Image
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'application/pdf';
                          fileInputRef.current.click();
                        }
                      }}>
                        <File className="mr-2 h-4 w-4" />
                        PDF Document
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!prompt.trim() || isGenerating}
                    className="h-8 w-8 shrink-0 rounded-full"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </Card>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </form>
          </div>
        </main>
      </SidebarInset>
    </>
  );
}

// Simple AutoScroll Helper
import { useRef, useEffect } from 'react';

function AutoScrollDiv({ messages }: { messages: unknown[] }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  return <div ref={messagesEndRef} />;
}
